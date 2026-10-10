import { Injectable } from '@nestjs/common'
import { OrderStatus, PaymentMethod, PaymentProvider } from '../generated/prisma/enums'
import type { GatewayPayment } from '../mercado-pago/payment-gateway'
import { OrderStatusService } from '../orders/order-status.service'
import { PrismaService } from '../prisma/prisma.service'

/** Records Mercado Pago payments, as read from its API, on the orders they pay. */
@Injectable()
export class PaymentSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statuses: OrderStatusService,
  ) {}

  /** Records one payment on the order of its reference. False when it is not for one of our Mercado Pago orders. */
  async record(payment: GatewayPayment): Promise<boolean> {
    if (!payment.reference) return false
    const order = await this.prisma.order.findUnique({
      where: { number: payment.reference },
      select: { id: true, paymentMethod: true },
    })
    if (order?.paymentMethod !== PaymentMethod.MERCADO_PAGO) return false
    await this.apply(order.id, payment)
    return true
  }

  /** Records the order's payments oldest first and returns the resulting order status. */
  async recordAll(orderId: number, status: OrderStatus, payments: GatewayPayment[]): Promise<OrderStatus> {
    let current = status
    for (const payment of [...payments].reverse()) current = await this.apply(orderId, payment)
    return current
  }

  private apply(orderId: number, payment: GatewayPayment): Promise<OrderStatus> {
    return this.statuses.recordPayment(
      orderId,
      {
        provider: PaymentProvider.MERCADO_PAGO,
        externalId: payment.id,
        status: payment.status,
        externalStatus: payment.externalStatus,
        externalStatusDetail: payment.externalStatusDetail,
        amount: payment.amount,
        currency: payment.currency,
        installments: payment.installments,
        approvedAt: payment.approvedAt,
      },
      `Pago aprobado en Mercado Pago (operación ${payment.id})`,
    )
  }
}
