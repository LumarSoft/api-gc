import { Prisma } from '../../generated/prisma/client'

/** Argentina has no daylight saving: its days start at 03:00 UTC. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const DASHBOARD_DAYS = 30

export interface DashboardRange {
  /** First instant of the current period (Argentine midnight, `days` days back including today). */
  from: Date
  /** First instant of the previous period, of the same length, right before `from`. */
  previousFrom: Date
  /** Argentine calendar days of the current period, oldest first ("2026-10-08"). */
  days: string[]
}

/** "2026-10-08": the Argentine calendar day of an instant. */
export function argentineDay(at: Date): string {
  return new Date(at.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10)
}

/** The last `days` Argentine days up to today, and the same length before them for comparison. */
export function dashboardRange(now: Date, days = DASHBOARD_DAYS): DashboardRange {
  const todayStart = Date.parse(`${argentineDay(now)}T00:00:00.000Z`) + AR_OFFSET_MS
  const from = todayStart - (days - 1) * DAY_MS
  return {
    from: new Date(from),
    previousFrom: new Date(from - days * DAY_MS),
    days: Array.from({ length: days }, (_, index) => argentineDay(new Date(from + index * DAY_MS))),
  }
}

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
