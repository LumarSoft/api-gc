import type { CartResponseDto } from '../../cart/dto/cart-response.dto'
import type { DeliveryMethod, PaymentMethod } from '../../generated/prisma/enums'
import type { MoneyDto } from '../../pricing/pricing.service'
import type { ShippingQuoteOptionDto } from '../../shipping/dto/shipping-quote-response.dto'
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
  /** The carrier option the buyer chose (CARRIER delivery). */
  shippingQuote: ShippingQuoteOptionDto | null
  /** Preview only; a separate order confirmation request reserves stock. */
  canReview: boolean
  reviewToken: string | null
  reservationHours: number
  /** How the buyer can pay, and how long each holds the stock. Mercado Pago only when it is configured. */
  paymentOptions: CheckoutPaymentOptionDto[]
}

export interface CheckoutPaymentOptionDto {
  method: PaymentMethod
  reservationMinutes: number
}
