import type { ResolvedPrice } from '../../pricing/pricing.service'
import type { Availability, ProductBadge, SpecificationGroupDto } from '../dto/product-response.dto'

/** Below or at this available quantity a product shows "pocas unidades", unless the variant sets its own threshold. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 3
/** Products published within this window get the NEW badge. */
export const NEW_BADGE_DAYS = 45

export type InventoryRow = { onHand: number; reserved: number; lowStockThreshold: number | null } | null

export function availabilityOf(inventory: InventoryRow): Availability {
  const available = inventory ? inventory.onHand - inventory.reserved : 0
  if (available <= 0) return 'OUT_OF_STOCK'
  return available <= (inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD) ? 'LOW_STOCK' : 'IN_STOCK'
}

/** A product is as available as its best variant. */
export function bestAvailability(values: Availability[]): Availability {
  if (values.includes('IN_STOCK')) return 'IN_STOCK'
  if (values.includes('LOW_STOCK')) return 'LOW_STOCK'
  return 'OUT_OF_STOCK'
}

export function badgeOf(
  price: ResolvedPrice | undefined,
  publishedAt: Date | null,
  now = new Date(),
): ProductBadge | null {
  if (price?.compareAtPrice && Number(price.compareAtPrice.amount) > Number(price.price.amount)) return 'OFFER'
  if (publishedAt && now.getTime() - publishedAt.getTime() < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000) return 'NEW'
  return null
}

/** Lowest price among the variants. Comparison only: never used to compute money. */
export function cheapest(prices: ResolvedPrice[]): ResolvedPrice | undefined {
  return [...prices].sort((a, b) => Number(a.price.amount) - Number(b.price.amount))[0]
}

/**
 * Orders by price; products without a price always go last, in both directions.
 * Comparison only: never used to compute money.
 */
export function compareByPrice(
  a: { price: { amount: string } | null },
  b: { price: { amount: string } | null },
  direction: 1 | -1,
): number {
  if (!a.price) return b.price ? 1 : 0
  if (!b.price) return -1
  return direction * (Number(a.price.amount) - Number(b.price.amount))
}

/** Rows ordered by sortOrder → groups in order of first appearance. */
export function groupSpecifications(
  rows: { groupName: string | null; name: string; value: string }[],
): SpecificationGroupDto[] {
  const groups: SpecificationGroupDto[] = []
  for (const row of rows) {
    let group = groups.find(existing => existing.group === row.groupName)
    if (!group) {
      group = { group: row.groupName, items: [] }
      groups.push(group)
    }
    group.items.push({ name: row.name, value: row.value })
  }
  return groups
}
