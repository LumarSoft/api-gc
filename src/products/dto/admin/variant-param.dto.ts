import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../../../common/constants/database'

/** `/admin/products/:id/variants/:variantId`. */
export class VariantParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  id: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  variantId: number
}
