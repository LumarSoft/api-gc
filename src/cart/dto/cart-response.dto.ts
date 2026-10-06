import type { MoneyDto } from '../../pricing/pricing.service'

export type CartItemIssue = 'UNAVAILABLE' | 'NO_PRICE' | 'NO_EXCHANGE_RATE' | 'INSUFFICIENT_STOCK'

export interface CartItemDto {
  variantId: number
  sku: string
  name: string
  variantName: string | null
  productSlug: string
  imageUrl: string | null
  quantity: number
  availableQuantity: number
  unitPrice: MoneyDto | null
  total: MoneyDto | null
  issue: CartItemIssue | null
}

export interface CartResponseDto {
  items: CartItemDto[]
  itemCount: number
  /** Null if a line cannot be priced in ARS; never silently sum only part of the cart. Excludes shipping. */
  subtotal: MoneyDto | null
  hasIssues: boolean
}
