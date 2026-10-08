import { addDays } from '../../common/utils/report-period'

export const GROUP_BY = ['day', 'week', 'month'] as const
export type GroupBy = (typeof GROUP_BY)[number]

/** Calendar days (Argentina) a chart point covers, both ends included, plus the same days of the previous period. */
export interface Bucket {
  start: string
  end: string
  previousStart: string
  previousEnd: string
}

/** Days for up to ~6 weeks, weeks up to ~6 months, months beyond: always between 7 and 46 points by default. */
export function defaultGroupBy(dayCount: number): GroupBy {
  if (dayCount <= 45) return 'day'
  if (dayCount <= 182) return 'week'
  return 'month'
}

/** The day itself, the Monday of its week or the first of its month. */
function bucketKey(day: string, groupBy: GroupBy): string {
  if (groupBy === 'day') return day
  if (groupBy === 'month') return day.slice(0, 7)
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

/**
 * The period's days grouped into calendar days, weeks (Monday to Sunday) or months, cut at the period's ends. Each
 * bucket also names the days it is compared with: the same offsets in the previous period of equal length.
 */
export function periodBuckets(days: string[], groupBy: GroupBy): Bucket[] {
  const groups: { key: string; start: string; end: string }[] = []
  for (const day of days) {
    const key = bucketKey(day, groupBy)
    const last = groups.at(-1)
    if (last?.key === key) last.end = day
    else groups.push({ key, start: day, end: day })
  }
  return groups.map(({ start, end }) => ({
    start,
    end,
    previousStart: addDays(start, -days.length),
    previousEnd: addDays(end, -days.length),
  }))
}

/** Which bucket each day falls in, for the period (`start`…`end`) and for the previous one. */
export function bucketIndex(buckets: Bucket[]): { current: Map<string, number>; previous: Map<string, number> } {
  const current = new Map<string, number>()
  const previous = new Map<string, number>()
  buckets.forEach((bucket, index) => {
    for (let day = bucket.start; day <= bucket.end; day = addDays(day, 1)) current.set(day, index)
    for (let day = bucket.previousStart; day <= bucket.previousEnd; day = addDays(day, 1)) previous.set(day, index)
  })
  return { current, previous }
}
