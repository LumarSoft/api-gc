import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../../common/constants/database'
import { MAX_CART_QUANTITY } from '../lib/cart-rules'

export class CartQuantityDto {
  @IsInt()
  @Min(1)
  @Max(MAX_CART_QUANTITY)
  quantity: number
}

export class AddCartItemDto extends CartQuantityDto {
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  variantId: number
}

export class CartVariantParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  variantId: number
}
