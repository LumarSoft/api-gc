import { Type } from 'class-transformer'
import { IsInt, Min } from 'class-validator'

/** `/admin/products/:id/variants/:variantId`. */
export class VariantParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId: number
}
