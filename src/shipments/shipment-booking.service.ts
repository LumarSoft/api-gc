import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { DeliveryMethod } from '../generated/prisma/enums'
import { AdminOrdersService } from '../orders/admin-orders.service'
import type { OrderResponseDto } from '../orders/dto/order-response.dto'
import { shipmentActions } from '../orders/lib/order-rules'
import { OrderStatusService } from '../orders/order-status.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  CarrierError,
  SHIPPING_CARRIER,
  type CarrierShipment,
  type CarrierShipmentRequest,
  type ShippingCarrier,
} from '../shipping/shipping-carrier'
import { carrierFailure } from './lib/carrier-failure'
import { bookingReference, bookingRequest, syncedShipmentData } from './lib/shipment-rules'
import { bookingOrderSelect, type BookingShipment } from './lib/shipment-selects'

/** Longer than the provider's booking timeout plus the time it takes to show a shipment in its lists. */
const BOOKING_GRACE_MS = 2 * 60_000

interface BookingClaim {
  shipment: BookingShipment
  request: CarrierShipmentRequest
  /** Another request started this booking moments ago and may still be running at the provider. */
  inFlight: boolean
}

/** Books an order's carrier shipment at the provider, never twice. */
@Injectable()
export class ShipmentBookingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_CARRIER) private readonly carrier: ShippingCarrier,
    private readonly orders: AdminOrdersService,
    private readonly statuses: OrderStatusService,
    private readonly audit: AuditLogsService,
  ) {}

  /**
   * The booking is claimed under the order lock, then requested with no transaction open. A booking whose answer was
   * lost is found again by its reference; while a recent claim may still be running, a retry only looks it up.
   */
  async create(orderId: number, actor: AuditActor): Promise<OrderResponseDto> {
    const claim = await this.claim(orderId)
    let remote: CarrierShipment | null
    try {
      remote = await this.carrier.findShipment(claim.request.reference)
      if (!remote && claim.inFlight)
        throw new ConflictException('El envío se está generando. Esperá un par de minutos y probá de nuevo.')
      remote ??= await this.carrier.createShipment(claim.request)
    } catch (error) {
      // A refusal is final, so the next try may book right away; after a timeout the claim stays until it is stale.
      if (error instanceof CarrierError && error.kind === 'REJECTED')
        await this.prisma.shipment.update({ where: { id: claim.shipment.id }, data: { bookingStartedAt: null } })
      carrierFailure(error)
    }
    await this.prisma.$transaction(async tx => {
      await tx.shipment.update({
        where: { id: claim.shipment.id },
        data: { ...syncedShipmentData(claim.shipment, remote), bookingStartedAt: null },
      })
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
    })
    const carrier = remote.carrier ?? claim.shipment.carrier ?? 'Transporte'
    await this.statuses.followShipment(orderId, remote.status, `${carrier}: ${remote.statusLabel}`.slice(0, 500))
    return this.orders.read(orderId)
  }

  private async claim(orderId: number): Promise<BookingClaim> {
    return this.prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${orderId} FOR UPDATE`
        const order = await tx.order.findUnique({ where: { id: orderId }, select: bookingOrderSelect })
        if (!order) throw new NotFoundException('Pedido no encontrado.')
        let shipment = order.shipments[0]
        if (!shipment || !shipmentActions(order.status, shipment).includes('CREATE'))
          throw new UnprocessableEntityException('Este pedido no tiene un envío para generar.')
        // Booking again after a cancellation: a new shipment with the same choice, and a new provider reference.
        if (shipment.externalId)
          shipment = await tx.shipment.create({
            data: {
              orderId,
              method: DeliveryMethod.CARRIER,
              carrier: shipment.carrier,
              service: shipment.service,
              carrierId: shipment.carrierId,
              serviceType: shipment.serviceType,
              logisticType: shipment.logisticType,
              pickupPointId: shipment.pickupPointId,
              pickupPoint: shipment.pickupPoint,
              cost: shipment.cost,
              currency: shipment.currency,
            },
            select: bookingOrderSelect.shipments.select,
          })
        const attempt = await tx.shipment.count({ where: { orderId } })
        const request = bookingRequest({ ...order, shipments: [shipment] }, bookingReference(order.number, attempt))
        if ('error' in request) throw new UnprocessableEntityException(request.error)
        const inFlight = Boolean(
          shipment.bookingStartedAt && Date.now() - shipment.bookingStartedAt.getTime() < BOOKING_GRACE_MS,
        )
        if (!inFlight) await tx.shipment.update({ where: { id: shipment.id }, data: { bookingStartedAt: new Date() } })
        return { shipment, request, inFlight }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }
}
