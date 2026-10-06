import { DeliveryMethod, OrderStatus } from '../../generated/prisma/enums'
import { orderTransitions } from './order-rules'
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
})
