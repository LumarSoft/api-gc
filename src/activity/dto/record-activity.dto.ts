import { Type } from 'class-transformer'
import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'
import { ActivityType } from '../../generated/prisma/enums'
import { PRODUCT_EVENTS } from '../lib/activity-rules'

/** One thing a store visitor did. `productId` for product events; `query` and `resultCount` for searches. */
export class RecordActivityDto {
  @IsIn(Object.values(ActivityType))
  type: ActivityType

  /** Random id the browser keeps for this visitor. */
  @IsUUID('4')
  visitorId: string

  @ValidateIf((dto: RecordActivityDto) => PRODUCT_EVENTS.includes(dto.type))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number

  @ValidateIf((dto: RecordActivityDto) => dto.type === ActivityType.SEARCH)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query?: string

  @ValidateIf((dto: RecordActivityDto) => dto.type === ActivityType.SEARCH)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  resultCount?: number
}
