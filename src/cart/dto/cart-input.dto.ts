import { Type } from 'class-transformer'
import { IsInt, Max, Min } from 'class-validator'
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
  @Max(2_147_483_647)
  variantId: number
}

export class CartVariantParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  variantId: number
}
