import { DeliveryMethod, OrderStatus, ShipmentStatus } from '../../generated/prisma/enums'

/**
 * The states staff can move an order to. Carrier orders are shipped and delivered only by the carrier's own status
 * (`carrierOrderStatus`), so the order never says "delivered" while the parcel is still at the store.
 */
export function orderTransitions(status: OrderStatus, delivery: DeliveryMethod): OrderStatus[] {
  if (delivery === DeliveryMethod.CARRIER && (status === OrderStatus.PREPARING || status === OrderStatus.SHIPPED))
    return []
  switch (status) {
    case OrderStatus.PENDING_PAYMENT:
      return [OrderStatus.CONFIRMED, OrderStatus.CANCELLED]
    case OrderStatus.CONFIRMED:
      return [OrderStatus.PREPARING]
    case OrderStatus.PREPARING:
      return [delivery === DeliveryMethod.STORE_PICKUP ? OrderStatus.READY_FOR_PICKUP : OrderStatus.SHIPPED]
    case OrderStatus.READY_FOR_PICKUP:
    case OrderStatus.SHIPPED:
      return [OrderStatus.DELIVERED]
    default:
      return []
  }
}

/**
 * The order state a carrier shipment implies, when the order is behind it: handed over (or waiting at a branch) means
 * shipped, delivered means delivered. Returns, losses and cancellations need a person, so they never move the order.
 */
export function carrierOrderStatus(status: OrderStatus, shipment: ShipmentStatus): OrderStatus | null {
  const fulfilling = status === OrderStatus.CONFIRMED || status === OrderStatus.PREPARING
  if (shipment === ShipmentStatus.DELIVERED && (fulfilling || status === OrderStatus.SHIPPED))
    return OrderStatus.DELIVERED
  if ((shipment === ShipmentStatus.IN_TRANSIT || shipment === ShipmentStatus.READY_FOR_PICKUP) && fulfilling)
    return OrderStatus.SHIPPED
  return null
}

export type ShipmentAction = 'CREATE' | 'DOCUMENTS' | 'CANCEL' | 'REFRESH'

/** Paid orders whose parcel may still need booking (staff may have marked one shipped before booking it). */
const BOOKABLE: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.SHIPPED]

/**
 * What staff can do with an order's carrier shipment. It is booked at the provider once the order is paid, and booked
 * again after a cancellation; labels and cancellation only make sense before the carrier has it.
 */
export function shipmentActions(
  status: OrderStatus,
  shipment: { status: ShipmentStatus; externalId: string | null },
): ShipmentAction[] {
  const bookable = BOOKABLE.includes(status)
  if (!shipment.externalId) return shipment.status === ShipmentStatus.PENDING && bookable ? ['CREATE'] : []
  if (shipment.status === ShipmentStatus.CANCELLED) return bookable ? ['CREATE', 'REFRESH'] : ['REFRESH']
  return shipment.status === ShipmentStatus.PENDING ? ['DOCUMENTS', 'CANCEL', 'REFRESH'] : ['DOCUMENTS', 'REFRESH']
}

/** Groups of states the admin works through, used as list views and counters. */
export const ORDER_STAGES = {
  /** Waiting for the payment (or its review). */
  PENDING_PAYMENT: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_UNDER_REVIEW],
  /** Paid, still to be prepared. */
  TO_FULFILL: [OrderStatus.CONFIRMED, OrderStatus.PREPARING],
  /** Ready for pickup or on its way. */
  READY: [OrderStatus.READY_FOR_PICKUP, OrderStatus.SHIPPED],
  /** Nothing left to do. */
  CLOSED: [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.EXPIRED],
} satisfies Record<string, OrderStatus[]>

export type OrderStage = keyof typeof ORDER_STAGES
export const ORDER_STAGE_NAMES = Object.keys(ORDER_STAGES) as OrderStage[]

/** Orders that need staff action, per open stage, from a count per status. */
export function stageCounts(
  byStatus: Partial<Record<OrderStatus, number>>,
): Record<Exclude<OrderStage, 'CLOSED'>, number> {
  const sum = (stage: OrderStage): number =>
    ORDER_STAGES[stage].reduce((total, status) => total + (byStatus[status] ?? 0), 0)
  return { PENDING_PAYMENT: sum('PENDING_PAYMENT'), TO_FULFILL: sum('TO_FULFILL'), READY: sum('READY') }
}
