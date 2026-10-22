import { Transform, Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { MAX_INT_ID } from '../../common/constants/database'
import { SystemLogLevel } from '../../generated/prisma/enums'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

class PageQueryDto {
  /** Capped so an absurd page cannot overflow the database offset (500). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25
}

/** `GET /admin/system/logs`: the API's errors and warnings of the last 30 days, newest first. */
export class ListSystemLogsDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(SystemLogLevel)
  level?: SystemLogLevel

  /** Exact source, as listed in `sources`. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  source?: string

  /** Partial match on the message or the route. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string
}

/** `GET /admin/system/activity`: what staff changed in the admin, newest first. */
export class ListSystemActivityDto extends PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  userId?: number

  /** Exact type, as listed in `entityTypes` (e.g. "Product", "Order"). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  entityType?: string
}
