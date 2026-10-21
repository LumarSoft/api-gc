import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../../common/constants/database'

/** `:productId` route parameter. */
export class FavoriteProductParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  productId: number
}
