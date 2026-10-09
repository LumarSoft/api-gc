import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import {
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ReservationStatus,
  ShipmentStatus,
} from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ChangeOrderStatusDto } from './dto/order-input.dto'
import type { OrderResponseDto } from './dto/order-response.dto'
import { carrierOrderStatus, orderTransitions } from './lib/order-rules'
import { adminOrderSelect } from './lib/order-selects'
import { OrderMapper } from './order.mapper'
import { OrderStockService } from './order-stock.service'

@Injectable()
export class OrderStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: OrderStockService,
    private readonly mapper: OrderMapper,
    private readonly audit: AuditLogsService,
  ) {}

  /** All existing-order transitions, including expiration, pass through this locked transaction. */
  async change(id: number, input: ChangeOrderStatusDto, actor?: AuditActor): Promise<OrderResponseDto> {
    return this.prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`
        const order = await tx.order.findUnique({
          where: { id },
          select: { status: true, deliveryMethod: true, expiresAt: true, total: true, currency: true },
        })
        if (!order) throw new NotFoundException('Pedido no encontrado.')
        const expired =
          order.status === OrderStatus.PENDING_PAYMENT && Boolean(order.expiresAt && order.expiresAt <= new Date())
        if (input.status === OrderStatus.EXPIRED) {
          if (actor || !expired)
            throw new UnprocessableEntityException('Este pedido no puede vencer en su estado actual.')
        } else {
          if (!actor || !orderTransitions(order.status, order.deliveryMethod).includes(input.status))
            throw new UnprocessableEntityException('Este cambio de estado no está permitido.')
          if (expired && input.status === OrderStatus.CONFIRMED)
            throw new UnprocessableEntityException('La reserva venció. No confirmes el pago de este pedido.')
        }
        if (input.status === OrderStatus.CONFIRMED) {
          if (!input.paymentReceived)
            throw new UnprocessableEntityException('Verificá el pago antes de confirmar el pedido.')
          await this.stock.resolve(tx, id, ReservationStatus.CONSUMED, actor?.userId)
          await tx.payment.create({
            data: {
              orderId: id,
              provider: PaymentProvider.MANUAL,
              purpose: 'ORDER',
              status: PaymentStatus.APPROVED,
              amount: order.total,
              currency: order.currency,
              approvedAt: new Date(),
            },
          })
        }
        if (input.status === OrderStatus.CANCELLED || input.status === OrderStatus.EXPIRED) {
          await this.stock.resolve(
            tx,
            id,
            input.status === OrderStatus.EXPIRED ? ReservationStatus.EXPIRED : ReservationStatus.RELEASED,
            actor?.userId,
          )
          // A carrier shipment is only booked once paid, so an unpaid order's shipment never left: close it.
          await tx.shipment.updateMany({
            where: { orderId: id, externalId: null, status: ShipmentStatus.PENDING },
            data: { status: ShipmentStatus.CANCELLED },
          })
        }
        const saved = await tx.order.update({
          where: { id },
          data: {
            status: input.status,
            ...(input.status === OrderStatus.CONFIRMED ? { confirmedAt: new Date() } : {}),
            ...(input.status === OrderStatus.CANCELLED
              ? { cancelledAt: new Date(), cancelReason: input.note?.trim() || null }
              : {}),
            statusHistory: {
              create: {
                fromStatus: order.status,
                toStatus: input.status,
                changedById: actor?.userId,
                note: input.note?.trim() || null,
              },
            },
          },
          select: adminOrderSelect,
        })
        if (actor)
          await this.audit.record(
            actor,
            {
              action: 'order.status',
              entityType: 'Order',
              entityId: id,
              changes: { status: { from: order.status, to: input.status } },
            },
            tx,
          )
        return this.mapper.adminResponse(saved)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }

  /**
   * The system transition that follows a carrier shipment (webhook or manual refresh), with no actor. Same order lock
   * as `change`; does nothing when the order is not behind the shipment, so repeated notifications are harmless.
   */
  async followShipment(id: number, shipment: ShipmentStatus, note: string): Promise<void> {
    await this.prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`
        const order = await tx.order.findUnique({ where: { id }, select: { status: true } })
        const next = order ? carrierOrderStatus(order.status, shipment) : null
        if (!order || !next) return
        await tx.order.update({
          where: { id },
          data: { status: next, statusHistory: { create: { fromStatus: order.status, toStatus: next, note } } },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }
}
