import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { OrderStatus, PaymentProvider, PaymentStatus, ReservationStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ChangeOrderStatusDto } from './dto/order-input.dto'
import type { OrderResponseDto } from './dto/order-response.dto'
import { orderTransitions } from './lib/order-rules'
import { orderSelect } from './lib/order-selects'
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
        if (input.status === OrderStatus.CANCELLED || input.status === OrderStatus.EXPIRED)
          await this.stock.resolve(
            tx,
            id,
            input.status === OrderStatus.EXPIRED ? ReservationStatus.EXPIRED : ReservationStatus.RELEASED,
            actor?.userId,
          )
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
          select: orderSelect,
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
        return this.mapper.response(saved, true)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }
}
