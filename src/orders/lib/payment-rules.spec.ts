import { Prisma } from '../../generated/prisma/client'
import { OrderStatus, PaymentStatus } from '../../generated/prisma/enums'
import { nextPaymentStatus, paysOrder, refundNeeded } from './payment-rules'

describe('nextPaymentStatus', () => {
  it('moves forward and never back', () => {
    expect(nextPaymentStatus(null, PaymentStatus.PENDING)).toBe(PaymentStatus.PENDING)
    expect(nextPaymentStatus(PaymentStatus.PENDING, PaymentStatus.APPROVED)).toBe(PaymentStatus.APPROVED)
    expect(nextPaymentStatus(PaymentStatus.IN_REVIEW, PaymentStatus.REJECTED)).toBe(PaymentStatus.REJECTED)
    expect(nextPaymentStatus(PaymentStatus.APPROVED, PaymentStatus.PENDING)).toBe(PaymentStatus.APPROVED)
    expect(nextPaymentStatus(PaymentStatus.APPROVED, PaymentStatus.IN_REVIEW)).toBe(PaymentStatus.APPROVED)
    expect(nextPaymentStatus(PaymentStatus.APPROVED, PaymentStatus.REFUNDED)).toBe(PaymentStatus.REFUNDED)
    expect(nextPaymentStatus(PaymentStatus.REFUNDED, PaymentStatus.APPROVED)).toBe(PaymentStatus.REFUNDED)
    expect(nextPaymentStatus(PaymentStatus.REJECTED, PaymentStatus.APPROVED)).toBe(PaymentStatus.REJECTED)
  })
})

describe('paysOrder', () => {
  const deadline = new Date('2026-10-10T13:00:00Z')
  const order = {
    status: OrderStatus.PENDING_PAYMENT,
    expiresAt: deadline,
    total: new Prisma.Decimal('42143.00'),
    currency: 'ARS',
  }
  const payment = { amount: '42143.00', currency: 'ARS', approvedAt: new Date('2026-10-10T12:30:00Z') }

  it('accepts the full amount approved before the deadline', () => {
    expect(paysOrder(order, payment)).toBe(true)
    expect(paysOrder(order, { ...payment, approvedAt: deadline })).toBe(true)
  })

  it('refuses late, partial, foreign-currency or unapproved payments and orders no longer waiting', () => {
    expect(paysOrder(order, { ...payment, approvedAt: new Date('2026-10-10T13:00:01Z') })).toBe(false)
    expect(paysOrder(order, { ...payment, approvedAt: null })).toBe(false)
    expect(paysOrder(order, { ...payment, amount: '42142.99' })).toBe(false)
    expect(paysOrder(order, { ...payment, currency: 'USD' })).toBe(false)
    expect(paysOrder({ ...order, status: OrderStatus.EXPIRED }, payment)).toBe(false)
    expect(paysOrder({ ...order, status: OrderStatus.CONFIRMED }, payment)).toBe(false)
  })
})

describe('refundNeeded', () => {
  const approved = { status: PaymentStatus.APPROVED }
  it('flags approved payments the order was not paid with', () => {
    expect(refundNeeded(OrderStatus.CONFIRMED, [approved])).toBe(false)
    expect(refundNeeded(OrderStatus.SHIPPED, [approved, { status: PaymentStatus.REJECTED }])).toBe(false)
    expect(refundNeeded(OrderStatus.CONFIRMED, [approved, approved])).toBe(true)
    expect(refundNeeded(OrderStatus.EXPIRED, [approved])).toBe(true)
    expect(refundNeeded(OrderStatus.CANCELLED, [{ status: PaymentStatus.REFUNDED }])).toBe(false)
    expect(refundNeeded(OrderStatus.PENDING_PAYMENT, [])).toBe(false)
  })
})
