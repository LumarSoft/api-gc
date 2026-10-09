import type { MoneyDto } from '../../pricing/pricing.service'

export interface ShippingQuoteOptionDto {
  /** Send it as `shippingQuoteId` to preview and confirm the order. */
  id: number
  /** HOME: to the buyer's address. PICKUP_POINT: the buyer picks the parcel up at `pickupPoint`. */
  kind: 'HOME' | 'PICKUP_POINT'
  carrier: string
  service: string
  cost: MoneyDto
  minDays: number | null
  maxDays: number | null
  pickupPoint: string | null
}

export interface ShippingQuotesResponseDto {
  options: ShippingQuoteOptionDto[]
  /** After this, quote again. */
  expiresAt: string
}
