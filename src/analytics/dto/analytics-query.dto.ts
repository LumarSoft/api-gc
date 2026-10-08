import { IsIn, IsOptional } from 'class-validator'
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto'
import { GROUP_BY, type GroupBy } from '../lib/analytics-buckets'

/** A report period (default: the last 30 days) and how to group its charts (default: by its length). */
export class AnalyticsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(GROUP_BY)
  groupBy?: GroupBy
}
