import { Prisma } from '../../generated/prisma/client'

/** Argentina has no daylight saving: its days start at 03:00 UTC. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const DASHBOARD_DAYS = 30
/** Longest range the home accepts (a leap year), so the daily series stays a few hundred points. */
export const DASHBOARD_MAX_DAYS = 366

export interface DashboardRange {
  /** First instant of the period (Argentine midnight of its first day). */
  from: Date
  /** First instant after the period (Argentine midnight of the day after its last day). */
  until: Date
  /** First instant of the previous period, of the same length, right before `from`. */
  previousFrom: Date
  /** Argentine calendar days of the period, oldest first ("2026-10-08"). */
  days: string[]
}

/** "2026-10-08": the Argentine calendar day of an instant. */
export function argentineDay(at: Date): string {
  return new Date(at.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10)
}

/** Argentine midnight of a calendar day ("2026-10-08" → 2026-10-08T03:00:00Z). */
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00.000Z`) + AR_OFFSET_MS

/** A real calendar day in YYYY-MM-DD ("2026-02-30" is not). */
export function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value)
}

/**
 * Why a requested range cannot be shown, or null: both ends or none, in order, not in the future, at most
 * DASHBOARD_MAX_DAYS long.
 */
export function rangeProblem(now: Date, from?: string, to?: string): string | null {
  if (!from && !to) return null
  if (!from || !to) return 'Indicá el inicio y el fin del período.'
  if (from > to) return 'El inicio del período tiene que ser anterior al fin.'
  if (to > argentineDay(now)) return 'El período no puede terminar en el futuro.'
  if ((dayStart(to) - dayStart(from)) / DAY_MS + 1 > DASHBOARD_MAX_DAYS)
    return `El período puede tener hasta ${DASHBOARD_MAX_DAYS} días.`
  return null
}

/**
 * The requested Argentine days (both ends included) or, without them, the last 30 days up to today; plus the
 * previous period of the same length for comparison. Call `rangeProblem` first.
 */
export function dashboardRange(now: Date, from?: string, to?: string): DashboardRange {
  const last = to ?? argentineDay(now)
  const lastStart = dayStart(last)
  const start = from ? dayStart(from) : lastStart - (DASHBOARD_DAYS - 1) * DAY_MS
  const length = Math.round((lastStart - start) / DAY_MS) + 1
  return {
    from: new Date(start),
    until: new Date(lastStart + DAY_MS),
    previousFrom: new Date(start - length * DAY_MS),
    days: Array.from({ length }, (_, index) => argentineDay(new Date(start + index * DAY_MS))),
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
