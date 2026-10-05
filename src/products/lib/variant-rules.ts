import { Prisma } from '../../generated/prisma/client'

const MAX_OPTIONS = 5
const MAX_PRICE = new Prisma.Decimal('9999999999.99')

/** Why the option values are invalid, or null. Shape: { "Color": "Cyan" } with short, non-empty strings. */
export function optionValuesError(options: Record<string, unknown> | null | undefined): string | null {
  if (!options) return null
  const entries = Object.entries(options)
  if (entries.length > MAX_OPTIONS) return `Use up to ${MAX_OPTIONS} options`
  const valid = entries.every(
    ([name, value]) =>
      name.trim().length > 0 &&
      name.length <= 50 &&
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 100,
  )
  return valid ? null : 'Each option needs a name (≤50 characters) and a value (≤100 characters)'
}

export interface PriceInput {
  priceListId: number
  amount: string
  compareAtAmount?: string | null
}

/** Why a set of prices is invalid, or null: positive amounts, one price per list, crossed-out price above the price. */
export function pricesError(prices: PriceInput[]): string | null {
  const lists = new Set(prices.map(price => price.priceListId))
  if (lists.size !== prices.length) return 'Send one price per price list'
  for (const price of prices) {
    const amount = new Prisma.Decimal(price.amount)
    if (amount.lte(0) || amount.gt(MAX_PRICE)) return 'Prices must be greater than zero'
    if (price.compareAtAmount && !new Prisma.Decimal(price.compareAtAmount).gt(amount)) {
      return 'The crossed-out price must be higher than the price'
    }
  }
  return null
}

/** The variant that becomes the default when the current default is archived: the first remaining active one. */
export function nextDefault<T extends { id: number; isActive: boolean }>(remaining: T[]): T | undefined {
  return remaining.find(variant => variant.isActive)
}
