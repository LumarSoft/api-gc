import { DeliveryMethod, OrderStatus } from '../../generated/prisma/enums'

export function orderTransitions(status: OrderStatus, delivery: DeliveryMethod): OrderStatus[] {
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
