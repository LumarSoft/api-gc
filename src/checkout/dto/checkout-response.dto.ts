import type { CartResponseDto } from '../../cart/dto/cart-response.dto'
import type { DeliveryMethod } from '../../generated/prisma/enums'
import type { MoneyDto } from '../../pricing/pricing.service'
import type { CheckoutAddressDto } from './checkout-input.dto'

export interface CheckoutDeliveryDto {
  code: DeliveryMethod
  name: string
  description: string
  enabled: boolean
  cost: MoneyDto | null
  unavailableReason: string | null
}

export interface CheckoutResponseDto {
  cart: CartResponseDto
  deliveryOptions: CheckoutDeliveryDto[]
  deliveryMethod: DeliveryMethod
  shippingTotal: MoneyDto | null
  total: MoneyDto | null
  customer: { name: string; email: string; phone: string | null } | null
  shippingAddress: CheckoutAddressDto | null
  /** A preview does not place an order or reserve stock. Payment setup is a separate stage. */
  canReview: boolean
}
