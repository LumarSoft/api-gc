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
