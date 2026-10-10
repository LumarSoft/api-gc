import { Prisma } from '../../generated/prisma/client'
import { OrderStatus, PaymentProvider, PaymentStatus } from '../../generated/prisma/enums'

/** A payment as an online provider reports it (read from its API), ready to be recorded on an order. */
export interface ProviderPayment {
  provider: PaymentProvider
  externalId: string
  status: PaymentStatus
  externalStatus: string
  externalStatusDetail: string | null
  /** Decimal string. */
  amount: string
  currency: string
  installments: number | null
  approvedAt: Date | null
}

const FINAL: PaymentStatus[] = [PaymentStatus.REJECTED, PaymentStatus.CANCELLED, PaymentStatus.REFUNDED]

/**
 * A payment only moves forward: pending or in review, then approved, rejected or cancelled; approved can later be
 * refunded. Two notifications read in a different order than they happened never move it back.
 */
export function nextPaymentStatus(current: PaymentStatus | null, reported: PaymentStatus): PaymentStatus {
  if (!current || current === reported) return reported
  if (FINAL.includes(current)) return current
  if (current === PaymentStatus.APPROVED) return reported === PaymentStatus.REFUNDED ? reported : current
  return reported
}

/**
 * Whether an approved payment pays the order: the order is still waiting for it, it was approved before the
 * reservation deadline (so the stock is still held for it) and it covers the exact total in the order currency.
 */
export function paysOrder(
  order: { status: OrderStatus; expiresAt: Date | null; total: Prisma.Decimal; currency: string },
  payment: Pick<ProviderPayment, 'amount' | 'currency' | 'approvedAt'>,
): boolean {
  return (
    order.status === OrderStatus.PENDING_PAYMENT &&
    Boolean(payment.approvedAt && order.expiresAt && payment.approvedAt <= order.expiresAt) &&
    payment.currency === order.currency &&
    order.total.equals(payment.amount)
  )
}

const PAID: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
]

/**
 * An approved payment the order was not paid with (approved too late, a second payment, another amount): staff
 * give it back from the provider's panel. A paid order keeps exactly one approved payment.
 */
export function refundNeeded(status: OrderStatus, payments: { status: PaymentStatus }[]): boolean {
  const approved = payments.filter(payment => payment.status === PaymentStatus.APPROVED).length
  return approved > (PAID.includes(status) ? 1 : 0)
}
