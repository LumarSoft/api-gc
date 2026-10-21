import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../constants/database'

/** `:id` route parameter. */
export class IdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  id: number
}
