/** Argentina has no daylight saving: its days start at 03:00 UTC. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** Default length of a report period (admin home, stats). */
export const REPORT_DAYS = 30
/** Longest period a report accepts (a leap year), so series stay a few hundred points. */
export const REPORT_MAX_DAYS = 366

export interface ReportPeriod {
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

/** Argentine midnight of a calendar day ("2026-10-08" → 2026-10-08T03:00:00Z), in ms. */
export const argentineMidnight = (day: string): number => Date.parse(`${day}T00:00:00.000Z`) + AR_OFFSET_MS

/** The calendar day `count` days after (or before, if negative) another one. */
export const addDays = (day: string, count: number): string =>
  argentineDay(new Date(argentineMidnight(day) + count * DAY_MS))

/** A real calendar day in YYYY-MM-DD ("2026-02-30" is not). */
export function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value)
}

/**
 * Why a requested period cannot be shown, or null: both ends or none, in order, not in the future, at most
 * REPORT_MAX_DAYS long.
 */
export function periodProblem(now: Date, from?: string, to?: string): string | null {
  if (!from && !to) return null
  if (!from || !to) return 'Indicá el inicio y el fin del período.'
  if (from > to) return 'El inicio del período tiene que ser anterior al fin.'
  if (to > argentineDay(now)) return 'El período no puede terminar en el futuro.'
  if ((argentineMidnight(to) - argentineMidnight(from)) / DAY_MS + 1 > REPORT_MAX_DAYS)
    return `El período puede tener hasta ${REPORT_MAX_DAYS} días.`
  return null
}

/**
 * The requested Argentine days (both ends included) or, without them, the last 30 days up to today; plus the
 * previous period of the same length for comparison. Call `periodProblem` first.
 */
export function reportPeriod(now: Date, from?: string, to?: string): ReportPeriod {
  const last = to ?? argentineDay(now)
  const lastStart = argentineMidnight(last)
  const start = from ? argentineMidnight(from) : lastStart - (REPORT_DAYS - 1) * DAY_MS
  const length = Math.round((lastStart - start) / DAY_MS) + 1
  return {
    from: new Date(start),
    until: new Date(lastStart + DAY_MS),
    previousFrom: new Date(start - length * DAY_MS),
    days: Array.from({ length }, (_, index) => argentineDay(new Date(start + index * DAY_MS))),
  }
}
