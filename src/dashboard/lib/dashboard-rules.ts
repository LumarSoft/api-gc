import { Prisma } from '../../generated/prisma/client'

export interface PaidOrder {
  confirmedAt: Date
  total: Prisma.Decimal
}

export interface PeriodTotals {
  sales: Prisma.Decimal
  paidOrders: number
}

/** Sales and paid orders of one period. */
export function periodTotals(orders: PaidOrder[]): PeriodTotals {
  return {
    sales: orders.reduce((sum, order) => sum.plus(order.total), new Prisma.Decimal(0)),
    paidOrders: orders.length,
  }
}

/** Average paid order, or null without paid orders (never a division by zero). */
export function averageOrder(totals: PeriodTotals): Prisma.Decimal | null {
  return totals.paidOrders > 0 ? totals.sales.dividedBy(totals.paidOrders) : null
}

/** One value per day of the range (zero on days without activity), oldest first. */
export function dailySeries<T>(
  days: string[],
  items: T[],
  dayOf: (item: T) => string,
  add: (current: Prisma.Decimal, item: T) => Prisma.Decimal,
): Prisma.Decimal[] {
  const totals = new Map(days.map(day => [day, new Prisma.Decimal(0)]))
  for (const item of items) {
    const day = dayOf(item)
    const current = totals.get(day)
    if (current) totals.set(day, add(current, item))
  }
  return days.map(day => totals.get(day)!)
}
