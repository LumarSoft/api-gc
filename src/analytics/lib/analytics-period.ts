import { BadRequestException } from '@nestjs/common'
import { periodProblem, reportPeriod, type ReportPeriod } from '../../common/utils/report-period'
import type { AnalyticsQueryDto } from '../dto/analytics-query.dto'
import { type Bucket, bucketIndex, defaultGroupBy, type GroupBy, periodBuckets } from './analytics-buckets'

export type Window = { gte: Date; lt: Date }

export interface AnalyticsPeriod {
  period: ReportPeriod
  groupBy: GroupBy
  buckets: Bucket[]
  /** Bucket of each day, for the period and for the previous one. */
  index: { current: Map<string, number>; previous: Map<string, number> }
  current: Window
  previous: Window
  /** Both periods together, oldest first. */
  both: Window
  /** What the response says about the period. */
  summary: { from: string; to: string; previousFrom: string; previousTo: string; groupBy: GroupBy }
}

/** The requested period (or the last 30 days), its chart points and the previous period; 400 when invalid. */
export function analyticsPeriod(query: AnalyticsQueryDto, now: Date): AnalyticsPeriod {
  const problem = periodProblem(now, query.from, query.to)
  if (problem) throw new BadRequestException(problem)
  const period = reportPeriod(now, query.from, query.to)
  const groupBy = query.groupBy ?? defaultGroupBy(period.days.length)
  const buckets = periodBuckets(period.days, groupBy)
  return {
    period,
    groupBy,
    buckets,
    index: bucketIndex(buckets),
    current: { gte: period.from, lt: period.until },
    previous: { gte: period.previousFrom, lt: period.from },
    both: { gte: period.previousFrom, lt: period.until },
    summary: {
      from: period.days[0],
      to: period.days.at(-1)!,
      previousFrom: buckets[0].previousStart,
      previousTo: buckets.at(-1)!.previousEnd,
      groupBy,
    },
  }
}
