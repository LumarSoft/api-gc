/** Something a product still needs; shown in the admin list and checked before publishing. */
export type ProductIssue = 'NO_ACTIVE_VARIANT' | 'NO_RETAIL_PRICE' | 'NO_SHIPPING_DATA' | 'NO_IMAGE'

export interface ProductCompleteness {
  imageCount: number
  /**
   * Active (not archived, not deactivated) variants: whether each has a retail price, and weight and measurements
   * (every active variant can be bought, and the carrier cannot quote a unit without them).
   */
  activeVariants: { hasRetailPrice: boolean; hasShippingData: boolean }[]
}

export function productIssues({ imageCount, activeVariants }: ProductCompleteness): ProductIssue[] {
  const issues: ProductIssue[] = []
  if (activeVariants.length === 0) issues.push('NO_ACTIVE_VARIANT')
  else if (!activeVariants.some(variant => variant.hasRetailPrice)) issues.push('NO_RETAIL_PRICE')
  if (activeVariants.some(variant => !variant.hasShippingData)) issues.push('NO_SHIPPING_DATA')
  if (imageCount === 0) issues.push('NO_IMAGE')
  return issues
}

/**
 * Issues that stop a product from being published. A missing image only warns (decision of 2026-10-04); weight and
 * measurements are required so every published product can be shipped by carrier (decision of 2026-10-09).
 */
export const PUBLISH_BLOCKERS: readonly ProductIssue[] = ['NO_ACTIVE_VARIANT', 'NO_RETAIL_PRICE', 'NO_SHIPPING_DATA']

const BLOCKER_MESSAGES: Record<ProductIssue, string> = {
  NO_ACTIVE_VARIANT: 'it has no active variant',
  NO_RETAIL_PRICE: 'no active variant has a retail price',
  NO_SHIPPING_DATA: 'an active variant has no weight or measurements',
  NO_IMAGE: 'it has no image',
}

/** Why a product cannot be published, as one sentence, or null when it can. */
export function publishBlockerMessage(issues: ProductIssue[]): string | null {
  const blockers = issues.filter(issue => PUBLISH_BLOCKERS.includes(issue))
  return blockers.length ? `Cannot publish: ${blockers.map(issue => BLOCKER_MESSAGES[issue]).join(' and ')}` : null
}

/** "Epson L3250" → "Epson L3250 (copia)", within the column length. */
export function copyName(name: string, maxLength = 200): string {
  const suffix = ' (copia)'
  return `${name.slice(0, maxLength - suffix.length)}${suffix}`
}

/**
 * Candidates for a unique copy identifier: "l3250-copia", "l3250-copia-2", … (or "C13T544-COPIA" for SKUs).
 * The base is cut so every candidate fits in `maxLength`.
 */
export function copyCandidates(base: string, marker: string, maxLength: number, count = 20): string[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = index === 0 ? `-${marker}` : `-${marker}-${index + 1}`
    return `${base.slice(0, maxLength - suffix.length)}${suffix}`
  })
}

/** "epson-l3250", "epson-l3250-2", "epson-l3250-3"…: free slugs for a new product named like an existing one. */
export function numberedCandidates(base: string, maxLength: number, count = 20): string[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = index === 0 ? '' : `-${index + 1}`
    return `${base.slice(0, maxLength - suffix.length)}${suffix}`
  })
}
