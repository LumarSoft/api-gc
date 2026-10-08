import { DeliveryMethod, OrderStatus } from '../../generated/prisma/enums'
import { ORDER_STAGES, orderTransitions, stageCounts } from './order-rules'
import { reservationHours } from './reservation-hours'

describe('manual order lifecycle', () => {
  it('requires payment confirmation before preparation', () => {
    expect(orderTransitions(OrderStatus.PENDING_PAYMENT, DeliveryMethod.STORE_PICKUP)).toEqual([
      OrderStatus.CONFIRMED,
      OrderStatus.CANCELLED,
    ])
    expect(orderTransitions(OrderStatus.CONFIRMED, DeliveryMethod.STORE_PICKUP)).toEqual([OrderStatus.PREPARING])
  })
  it('separates pickup from delivery', () => {
    expect(orderTransitions(OrderStatus.PREPARING, DeliveryMethod.STORE_PICKUP)).toEqual([OrderStatus.READY_FOR_PICKUP])
    expect(orderTransitions(OrderStatus.PREPARING, DeliveryMethod.LOCAL_DELIVERY)).toEqual([OrderStatus.SHIPPED])
  })
  it.each([OrderStatus.CANCELLED, OrderStatus.EXPIRED, OrderStatus.DELIVERED])('keeps %s terminal', status => {
    expect(orderTransitions(status, DeliveryMethod.STORE_PICKUP)).toEqual([])
  })
  it('uses a valid configured reservation window and ignores malformed settings', () => {
    expect(reservationHours({ value: 48, deletedAt: null })).toBe(48)
    for (const value of [0, -1, 169, 1.5, '24', null, {}]) expect(reservationHours({ value, deletedAt: null })).toBe(24)
    expect(reservationHours({ value: 48, deletedAt: new Date() })).toBe(24)
  })
  it('places every status in exactly one admin stage', () => {
    const grouped = Object.values(ORDER_STAGES).flat()
    expect(new Set(grouped).size).toBe(grouped.length)
    expect(grouped.sort()).toEqual(Object.values(OrderStatus).sort())
  })
  it('adds the open stages from a count per status', () => {
    expect(
      stageCounts({
        PENDING_PAYMENT: 2,
        PAYMENT_UNDER_REVIEW: 1,
        CONFIRMED: 3,
        PREPARING: 1,
        SHIPPED: 4,
        DELIVERED: 9,
      }),
    ).toEqual({ PENDING_PAYMENT: 3, TO_FULFILL: 4, READY: 4 })
  })
})
