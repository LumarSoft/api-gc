import { Prisma } from '../../generated/prisma/client'
import { OrderStatus } from '../../generated/prisma/enums'
import { ORDER_STAGES } from '../../orders/lib/order-rules'

type Decimal = Prisma.Decimal
const zero = (): Decimal => new Prisma.Decimal(0)

/** Orders whose payment staff verified (the store's sales). Cancelled after paying = not a sale. */
export const PAID_STATUSES: OrderStatus[] = [...ORDER_STAGES.TO_FULFILL, ...ORDER_STAGES.READY, OrderStatus.DELIVERED]

export interface PaidOrderRow {
  placedAt: Date
  confirmedAt: Date
  subtotal: Decimal
  discountTotal: Decimal
  shippingTotal: Decimal
  total: Decimal
  contactEmail: string
}

export const sumOf = <T>(items: T[], value: (item: T) => Decimal): Decimal =>
  items.reduce((sum, item) => sum.plus(value(item)), zero())

/** One total per bucket (zero when empty); items on days outside `index` are ignored. */
export function bucketSeries<T>(
  items: T[],
  dayOf: (item: T) => string,
  value: (item: T) => Decimal | number,
  index: Map<string, number>,
  length: number,
): Decimal[] {
  const series = Array.from({ length }, zero)
  for (const item of items) {
    const bucket = index.get(dayOf(item))
    if (bucket !== undefined) series[bucket] = series[bucket].plus(value(item))
  }
  return series
}

/** What the sales are made of: products (before discounts), discounts and shipping. */
export function salesBreakdown(orders: PaidOrderRow[]): { products: Decimal; discounts: Decimal; shipping: Decimal } {
  return {
    products: sumOf(orders, order => order.subtotal),
    discounts: sumOf(orders, order => order.discountTotal),
    shipping: sumOf(orders, order => order.shippingTotal),
  }
}

/** Median time from placing the order to staff confirming its payment, in hours (one decimal); null without orders. */
export function medianHoursToPay(orders: PaidOrderRow[]): number | null {
  if (orders.length === 0) return null
  const hours = orders
    .map(order => (order.confirmedAt.getTime() - order.placedAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b)
  const middle = Math.floor(hours.length / 2)
  const median = hours.length % 2 === 1 ? hours[middle] : (hours[middle - 1] + hours[middle]) / 2
  return Math.round(Math.max(median, 0) * 10) / 10
}

export interface OrderOutcomes {
  placed: number
  paid: number
  /** Still waiting for the payment or its review. */
  waiting: number
  /** The reservation ran out without a payment. */
  expired: number
  cancelled: number
}

/** What became of the orders placed in a period, from their current status. */
export function orderOutcomes(statuses: OrderStatus[]): OrderOutcomes {
  const count = (group: OrderStatus[]) => statuses.filter(status => group.includes(status)).length
  return {
    placed: statuses.length,
    paid: count(PAID_STATUSES),
    waiting: count(ORDER_STAGES.PENDING_PAYMENT),
    expired: count([OrderStatus.EXPIRED]),
    cancelled: count([OrderStatus.CANCELLED]),
  }
}

export interface MixRow<K> {
  key: K
  orders: number
  sales: Decimal
  previousSales: Decimal
}

/** Paid orders and sales per value of `keyOf` (buyer type, payment method…), biggest first. */
export function salesMix<T extends { total: Decimal }, K extends string>(
  current: T[],
  previous: T[],
  keyOf: (order: T) => K,
): MixRow<K>[] {
  const rows = new Map<K, MixRow<K>>()
  const row = (key: K) =>
    rows.get(key) ?? rows.set(key, { key, orders: 0, sales: zero(), previousSales: zero() }).get(key)!
  for (const order of current) {
    const target = row(keyOf(order))
    target.orders += 1
    target.sales = target.sales.plus(order.total)
  }
  for (const order of previous) {
    const target = row(keyOf(order))
    target.previousSales = target.previousSales.plus(order.total)
  }
  return [...rows.values()].filter(row => row.orders > 0).sort((a, b) => b.sales.comparedTo(a.sales))
}

/** Customers are told apart by email: guests have no account, and it is what ties their orders together. */
export const customerKey = (email: string): string => email.trim().toLowerCase()

export interface CustomerSplit {
  customers: number
  /** Customers who had already paid an order before the period. */
  returning: number
  newSales: Decimal
  returningSales: Decimal
}

/** New and returning customers of a period, given who had paid before it. */
export function customerSplit(orders: PaidOrderRow[], boughtBefore: Set<string>): CustomerSplit {
  const customers = new Set(orders.map(order => customerKey(order.contactEmail)))
  const isReturning = (order: PaidOrderRow) => boughtBefore.has(customerKey(order.contactEmail))
  return {
    customers: customers.size,
    returning: [...customers].filter(customer => boughtBefore.has(customer)).length,
    newSales: sumOf(
      orders.filter(order => !isReturning(order)),
      order => order.total,
    ),
    returningSales: sumOf(orders.filter(isReturning), order => order.total),
  }
}

export interface SoldLine<K> {
  key: K
  name: string
  units: number
  sales: Decimal
}

export interface RankRow<K> extends SoldLine<K> {
  previousSales: Decimal
  previousUnits: number
}

/** Adds up lines of the same key (variants of one product, products of one category). */
export function sumLines<K>(lines: SoldLine<K>[]): Map<K, SoldLine<K>> {
  const totals = new Map<K, SoldLine<K>>()
  for (const line of lines) {
    const total = totals.get(line.key)
    if (total) {
      total.units += line.units
      total.sales = total.sales.plus(line.sales)
    } else totals.set(line.key, { ...line })
  }
  return totals
}

/**
 * The top `limit` of the period by sales (then units) or by units (then sales), each with what it sold in the previous
 * period.
 */
export function topRows<K>(
  current: Map<K, SoldLine<K>>,
  previous: Map<K, SoldLine<K>>,
  limit: number,
  by: 'sales' | 'units' = 'sales',
): RankRow<K>[] {
  const bySales = (a: SoldLine<K>, b: SoldLine<K>) => b.sales.comparedTo(a.sales)
  const byUnits = (a: SoldLine<K>, b: SoldLine<K>) => b.units - a.units
  return [...current.values()]
    .sort((a, b) => (by === 'sales' ? bySales(a, b) || byUnits(a, b) : byUnits(a, b) || bySales(a, b)))
    .slice(0, limit)
    .map(row => ({
      ...row,
      previousSales: previous.get(row.key)?.sales ?? zero(),
      previousUnits: previous.get(row.key)?.units ?? 0,
    }))
}
