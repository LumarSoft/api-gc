import { createHash } from 'node:crypto'
import type { CartResponseDto } from '../../cart/dto/cart-response.dto'
import type { MoneyDto } from '../../pricing/pricing.service'
import { DeliveryMethod } from '../../generated/prisma/enums'
import type { PreviewCheckoutDto } from '../dto/checkout-input.dto'

/** Detects changed lines/prices/delivery between review and confirmation. This is not an authorization token. */
export function checkoutReview(cart: CartResponseDto, input: PreviewCheckoutDto, shipping: MoneyDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        items: cart.items.map(item => [
          item.variantId,
          item.quantity,
          item.unitPrice?.amount,
          item.name,
          item.variantName,
        ]),
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        deliveryMethod: input.deliveryMethod,
        address:
          input.deliveryMethod === DeliveryMethod.LOCAL_DELIVERY && input.shippingAddress
            ? [
                input.shippingAddress.street,
                input.shippingAddress.streetNumber,
                input.shippingAddress.city,
                input.shippingAddress.province,
                input.shippingAddress.postalCode,
              ]
            : null,
        shipping: shipping.amount,
      }),
    )
    .digest('hex')
}
