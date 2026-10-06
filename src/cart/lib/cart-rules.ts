import type { CartItemIssue } from '../dto/cart-response.dto'

/** Technical bound for request quantities and guest-cart merges (not a purchase policy). */
export const MAX_CART_QUANTITY = 1_000_000

export function mergedQuantity(current: number, incoming: number): number {
  return Math.min(current + incoming, MAX_CART_QUANTITY)
}

export function cartItemIssue(
  visible: boolean,
  currency: string | undefined,
  available: number,
  quantity: number,
): CartItemIssue | null {
  if (!visible) return 'UNAVAILABLE'
  if (!currency) return 'NO_PRICE'
  if (currency !== 'ARS') return 'NO_EXCHANGE_RATE'
  if (quantity > available) return 'INSUFFICIENT_STOCK'
  return null
}
