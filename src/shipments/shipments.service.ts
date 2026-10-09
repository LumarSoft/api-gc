import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { AdminOrdersService } from '../orders/admin-orders.service'
import type { OrderResponseDto } from '../orders/dto/order-response.dto'
import { shipmentActions, type ShipmentAction } from '../orders/lib/order-rules'
import { OrderStatusService } from '../orders/order-status.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  CarrierError,
  SHIPPING_CARRIER,
  type CarrierDocument,
  type CarrierDocumentFormat,
  type CarrierDocumentKind,
  type CarrierShipment,
  type ShippingCarrier,
} from '../shipping/shipping-carrier'
import { bookingRequest, syncedShipmentData } from './lib/shipment-rules'
import { bookingOrderSelect, syncedShipmentSelect, type SyncedShipment } from './lib/shipment-selects'

/** Turns a provider failure into the error staff see. The provider's own validation message helps them fix data. */
function carrierFailure(error: unknown): never {
  if (!(error instanceof CarrierError)) throw error
  if (error.kind === 'REJECTED')
    throw new UnprocessableEntityException(`Zipnova rechazó la operación: ${error.message}`)
  if (error.kind === 'NOT_READY')
    throw new UnprocessableEntityException('Zipnova todavía no generó la documentación. Probá en unos minutos.')
  if (error.kind === 'NOT_FOUND') throw new NotFoundException('Zipnova no encuentra este envío.')
  throw new ServiceUnavailableException('Zipnova no responde. Probá de nuevo en unos minutos.')
}

/** Carrier shipments of orders: booking at the provider, documents, cancellation and status sync. */
@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_CARRIER) private readonly carrier: ShippingCarrier,
    private readonly orders: AdminOrdersService,
    private readonly statuses: OrderStatusService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * Books the shipment at the provider under the order lock, so two clicks cannot book it twice. Looking it up by
   * order number first recovers a booking whose answer was lost.
   */
  async create(orderId: number, actor: AuditActor): Promise<OrderResponseDto> {
    const booked = await this.prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} FOR UPDATE`
        const order = await tx.order.findUnique({ where: { id: orderId }, select: bookingOrderSelect })
        if (!order) throw new NotFoundException('Pedido no encontrado.')
        const shipment = order.shipments[0]
        if (!shipment || !shipmentActions(order.status, shipment).includes('CREATE'))
          throw new UnprocessableEntityException('Este pedido no tiene un envío para generar.')
        const request = bookingRequest(order)
        if ('error' in request) throw new UnprocessableEntityException(request.error)
        let remote: CarrierShipment
        try {
          remote = (await this.carrier.findShipment(order.number)) ?? (await this.carrier.createShipment(request))
        } catch (error) {
          carrierFailure(error)
        }
        await tx.shipment.update({ where: { id: shipment.id }, data: syncedShipmentData(shipment, remote) })
        await this.audit.record(
          actor,
          {
            action: 'shipment.create',
            entityType: 'Order',
            entityId: orderId,
            changes: { shipment: { from: null, to: remote.id } },
          },
          tx,
        )
        return { remote, carrier: remote.carrier ?? shipment.carrier }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 },
    )
    await this.statuses.followShipment(orderId, booked.remote.status, this.note(booked.carrier, booked.remote))
    return this.orders.read(orderId)
  }

  async cancel(orderId: number, actor: AuditActor): Promise<OrderResponseDto> {
    const shipment = await this.shipment(orderId, 'CANCEL')
    let result: 'CANCELLED' | 'RESCUE_REQUESTED'
    try {
      result = await this.carrier.cancelShipment(shipment.externalId!)
    } catch (error) {
      carrierFailure(error)
    }
    await this.audit.record(actor, {
      action: 'shipment.cancel',
      entityType: 'Order',
      entityId: orderId,
      changes: { shipment: { from: shipment.status, to: result } },
    })
    await this.syncOrFail(shipment)
    return this.orders.read(orderId)
  }

  async refresh(orderId: number): Promise<OrderResponseDto> {
    await this.syncOrFail(await this.shipment(orderId, 'REFRESH'))
    return this.orders.read(orderId)
  }

  async document(orderId: number, kind: CarrierDocumentKind, format: CarrierDocumentFormat): Promise<CarrierDocument> {
    if (kind === 'guide' && format !== 'pdf') throw new BadRequestException('La guía de despacho solo existe en PDF.')
    const shipment = await this.shipment(orderId, 'DOCUMENTS')
    let document: CarrierDocument
    try {
      document = await this.carrier.document(shipment.externalId!, kind, format)
    } catch (error) {
      carrierFailure(error)
    }
    // Downloading moves the shipment to "ready to ship" at the provider; mirror it without failing the download.
    await this.sync(shipment).catch(() => this.logger.warn(`Could not refresh shipment ${shipment.id} after download`))
    return document
  }

  /**
   * Provider webhook. The body only says which shipment changed: its state is read from the provider. Unknown
   * shipments (booked by hand in the provider's panel) are acknowledged and ignored.
   */
  async notify(token: string, body: unknown): Promise<void> {
    const notification = this.carrier.readNotification(token, body)
    if (notification === 'UNAUTHORIZED') throw new NotFoundException()
    if (notification === 'IGNORED') return
    const shipment = await this.prisma.shipment.findFirst({
      where: { externalId: notification.shipmentId, deletedAt: null },
      select: syncedShipmentSelect,
    })
    if (shipment) await this.syncOrFail(shipment)
  }

  private async shipment(orderId: number, action: ShipmentAction): Promise<SyncedShipment> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, shipments: bookingOrderSelect.shipments },
    })
    if (!order) throw new NotFoundException('Pedido no encontrado.')
    const shipment = order.shipments[0]
    if (!shipment || !shipmentActions(order.status, shipment).includes(action))
      throw new UnprocessableEntityException('Esta acción no está disponible para el envío de este pedido.')
    return shipment
  }

  private async syncOrFail(shipment: SyncedShipment): Promise<void> {
    try {
      await this.sync(shipment)
    } catch (error) {
      carrierFailure(error)
    }
  }

  private async sync(shipment: SyncedShipment): Promise<void> {
    const remote = await this.carrier.getShipment(shipment.externalId!)
    await this.prisma.shipment.update({ where: { id: shipment.id }, data: syncedShipmentData(shipment, remote) })
    await this.statuses.followShipment(shipment.orderId, remote.status, this.note(shipment.carrier, remote))
  }

  private note(carrier: string | null, remote: CarrierShipment): string {
    return `${remote.carrier ?? carrier ?? 'Transporte'}: ${remote.statusLabel}`.slice(0, 500)
  }
}
