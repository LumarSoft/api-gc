import { checkoutReview } from './checkout-review'
import type { CartResponseDto } from '../../cart/dto/cart-response.dto'
import { Currency, DeliveryMethod } from '../../generated/prisma/enums'

const cart: CartResponseDto = {
  items: [
    {
      variantId: 1,
      sku: 'TEST',
      name: 'Product',
      variantName: null,
      productSlug: 'product',
      imageUrl: null,
      quantity: 1,
      availableQuantity: 5,
      unitPrice: { amount: '12.35', currency: Currency.ARS },
      total: { amount: '12.35', currency: Currency.ARS },
      issue: null,
    },
  ],
  itemCount: 1,
  subtotal: { amount: '12.35', currency: Currency.ARS },
  hasIssues: false,
}
const input = { name: 'Test', email: 'test@example.test', deliveryMethod: DeliveryMethod.STORE_PICKUP }
const shipping = { amount: '0.00', currency: Currency.ARS }

describe('checkout review change detection', () => {
  it('rejects changed quantities, price, names, contact and delivery cost', () => {
    const reviewed = checkoutReview(cart, input, shipping)
    const withQuantity = { ...cart, items: [{ ...cart.items[0], quantity: 2 }] }
    const withPrice = { ...cart, items: [{ ...cart.items[0], unitPrice: { ...shipping, amount: '13.00' } }] }
    const withName = { ...cart, items: [{ ...cart.items[0], name: 'Other product' }] }
    for (const changed of [withQuantity, withPrice, withName])
      expect(checkoutReview(changed, input, shipping)).not.toBe(reviewed)
    expect(checkoutReview(cart, { ...input, email: 'other@example.test' }, shipping)).not.toBe(reviewed)
    expect(checkoutReview(cart, input, { ...shipping, amount: '5.00' })).not.toBe(reviewed)
  })
  it('ignores changing availability when the quantity is still valid', () => {
    expect(checkoutReview({ ...cart, items: [{ ...cart.items[0], availableQuantity: 4 }] }, input, shipping)).toBe(
      checkoutReview(cart, input, shipping),
    )
  })
  it('ignores an unused pickup address', () => {
    expect(
      checkoutReview(
        cart,
        {
          ...input,
          shippingAddress: {
            street: 'Test',
            streetNumber: '1',
            city: 'Rosario',
            province: 'Santa Fe',
            postalCode: '2000',
          },
        },
        shipping,
      ),
    ).toBe(checkoutReview(cart, input, shipping))
  })
})
