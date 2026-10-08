import { ActivityType } from '../../generated/prisma/enums'

/** A cart untouched for this long, never turned into an order, counts as abandoned. */
export const ABANDON_AFTER_HOURS = 24

/** Visitors and the step of the purchase they reached, each counted once. */
export interface Funnel {
  visited: number
  viewedProduct: number
  addedToCart: number
  startedCheckout: number
  placedOrder: number
}

const FUNNEL_STEP: Partial<Record<ActivityType, keyof Funnel>> = {
  [ActivityType.PRODUCT_VIEW]: 'viewedProduct',
  [ActivityType.ADD_TO_CART]: 'addedToCart',
  [ActivityType.CHECKOUT_STARTED]: 'startedCheckout',
  [ActivityType.ORDER_PLACED]: 'placedOrder',
}

/** The funnel from distinct visitors per event type, plus the visitors with any event. */
export function funnelFrom(visited: number, byType: { type: ActivityType; visitors: number }[]): Funnel {
  const funnel: Funnel = { visited, viewedProduct: 0, addedToCart: 0, startedCheckout: 0, placedOrder: 0 }
  for (const row of byType) {
    const step = FUNNEL_STEP[row.type]
    if (step) funnel[step] = row.visitors
  }
  return funnel
}

/** Distinct visitors per chart point, from (visitor, Argentine day) pairs. */
export function visitorSeries(
  visits: { visitorId: string; day: string }[],
  index: Map<string, number>,
  length: number,
): number[] {
  const visitors = Array.from({ length }, () => new Set<string>())
  for (const visit of visits) {
    const bucket = index.get(visit.day)
    if (bucket !== undefined) visitors[bucket].add(visit.visitorId)
  }
  return visitors.map(set => set.size)
}

/** End of the window in which an untouched cart already counts as abandoned. */
export function abandonedBefore(until: Date, now: Date): Date {
  const threshold = new Date(now.getTime() - ABANDON_AFTER_HOURS * 3_600_000)
  return threshold < until ? threshold : until
}

/** Carts (and units) per product, from cart lines; each cart counts once per product. */
export function cartsPerProduct(
  lines: { cartId: number; quantity: number; productId: number }[],
): { productId: number; carts: number; units: number }[] {
  const totals = new Map<number, { carts: Set<number>; units: number }>()
  for (const line of lines) {
    const total = totals.get(line.productId) ?? { carts: new Set<number>(), units: 0 }
    total.carts.add(line.cartId)
    total.units += line.quantity
    totals.set(line.productId, total)
  }
  return [...totals.entries()]
    .map(([productId, total]) => ({ productId, carts: total.carts.size, units: total.units }))
    .sort((a, b) => b.carts - a.carts || b.units - a.units)
}
