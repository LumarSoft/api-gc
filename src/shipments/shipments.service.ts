import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
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
import { carrierFailure } from './lib/carrier-failure'
import { staleShipmentStatus, syncedShipmentData } from './lib/shipment-rules'
import { bookingOrderSelect, syncedShipmentSelect, type SyncedShipment } from './lib/shipment-selects'

/** Carrier shipments of orders after booking: documents, cancellation and status sync (webhook or by hand). */
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
      if (error instanceof CarrierError && error.kind === 'NOT_READY' && (await this.outOfCredit()))
        throw new UnprocessableEntityException(
          'La cuenta de Zipnova no tiene saldo, por eso el envío sigue en "Procesando" y todavía no tiene etiqueta. Cargá crédito en Zipnova y volvé a descargarla.',
        )
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

  /** Without balance the provider keeps the shipment unprocessed; a failed read never hides the original error. */
  private async outOfCredit(): Promise<boolean> {
    const available = await this.carrier.availableCredit().catch(() => null)
    return available !== null && available <= 0
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

  /**
   * Reads the provider first, then writes under the shipment lock with what is stored now: of two racing
   * notifications, the one that read an older state cannot move a finished shipment back.
   */
  private async sync(shipment: SyncedShipment): Promise<void> {
    const remote = await this.carrier.getShipment(shipment.externalId!)
    const applied = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM Shipment WHERE id = ${shipment.id} FOR UPDATE`
      const current = await tx.shipment.findUniqueOrThrow({ where: { id: shipment.id }, select: syncedShipmentSelect })
      if (staleShipmentStatus(current.status, remote.status)) return false
      await tx.shipment.update({ where: { id: shipment.id }, data: syncedShipmentData(current, remote) })
      return true
    })
    if (applied)
      await this.statuses.followShipment(shipment.orderId, remote.status, this.note(shipment.carrier, remote))
  }

  private note(carrier: string | null, remote: CarrierShipment): string {
    return `${remote.carrier ?? carrier ?? 'Transporte'}: ${remote.statusLabel}`.slice(0, 500)
  }
}
