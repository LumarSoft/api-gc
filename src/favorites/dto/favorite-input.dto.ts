import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

/** `:productId` route parameter. */
export class FavoriteProductParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId: number
}
