import { DeliveryMethod, OrderStatus, ShipmentStatus } from '../../generated/prisma/enums'
import { ORDER_STAGES, carrierOrderStatus, orderTransitions, shipmentActions, stageCounts } from './order-rules'
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

describe('carrier-driven order status', () => {
  it('ships a paid order once the carrier has it, and delivers it when the carrier does', () => {
    expect(carrierOrderStatus(OrderStatus.CONFIRMED, ShipmentStatus.IN_TRANSIT)).toBe(OrderStatus.SHIPPED)
    expect(carrierOrderStatus(OrderStatus.PREPARING, ShipmentStatus.READY_FOR_PICKUP)).toBe(OrderStatus.SHIPPED)
    expect(carrierOrderStatus(OrderStatus.SHIPPED, ShipmentStatus.DELIVERED)).toBe(OrderStatus.DELIVERED)
    expect(carrierOrderStatus(OrderStatus.PREPARING, ShipmentStatus.DELIVERED)).toBe(OrderStatus.DELIVERED)
  })

  it.each([
    [OrderStatus.PENDING_PAYMENT, ShipmentStatus.IN_TRANSIT],
    [OrderStatus.SHIPPED, ShipmentStatus.IN_TRANSIT],
    [OrderStatus.CANCELLED, ShipmentStatus.DELIVERED],
    [OrderStatus.PREPARING, ShipmentStatus.PENDING],
    [OrderStatus.SHIPPED, ShipmentStatus.RETURNED],
    [OrderStatus.SHIPPED, ShipmentStatus.LOST],
    [OrderStatus.CONFIRMED, ShipmentStatus.CANCELLED],
  ])('leaves %s alone when the shipment is %s', (order, shipment) => {
    expect(carrierOrderStatus(order, shipment)).toBeNull()
  })
})

describe('carrier shipment actions', () => {
  const pending = { status: ShipmentStatus.PENDING, externalId: null }
  it('creates the shipment at the provider only for paid orders', () => {
    expect(shipmentActions(OrderStatus.PENDING_PAYMENT, pending)).toEqual([])
    expect(shipmentActions(OrderStatus.CONFIRMED, pending)).toEqual(['CREATE'])
    expect(shipmentActions(OrderStatus.PREPARING, pending)).toEqual(['CREATE'])
    expect(shipmentActions(OrderStatus.SHIPPED, pending)).toEqual(['CREATE'])
    expect(shipmentActions(OrderStatus.CANCELLED, pending)).toEqual([])
    expect(shipmentActions(OrderStatus.DELIVERED, pending)).toEqual([])
  })

  it('cancels only before the carrier has the parcel, and books again after a cancellation', () => {
    const created = { status: ShipmentStatus.PENDING, externalId: '9' }
    expect(shipmentActions(OrderStatus.PREPARING, created)).toEqual(['DOCUMENTS', 'CANCEL', 'REFRESH'])
    expect(shipmentActions(OrderStatus.SHIPPED, { ...created, status: ShipmentStatus.IN_TRANSIT })).toEqual([
      'DOCUMENTS',
      'REFRESH',
    ])
    expect(shipmentActions(OrderStatus.PREPARING, { ...created, status: ShipmentStatus.CANCELLED })).toEqual([
      'CREATE',
      'REFRESH',
    ])
    expect(shipmentActions(OrderStatus.DELIVERED, { ...created, status: ShipmentStatus.CANCELLED })).toEqual([
      'REFRESH',
    ])
  })
})
