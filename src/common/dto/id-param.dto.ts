import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

/** `:id` route parameter. */
export class IdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number
}
