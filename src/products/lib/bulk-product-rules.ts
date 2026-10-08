import { ProductStatus } from '../../generated/prisma/enums'
import { PUBLISH_BLOCKERS, type ProductIssue } from './admin-product-rules'

export const BULK_PRODUCT_ACTIONS = ['PUBLISH', 'HIDE', 'DRAFT', 'ARCHIVE'] as const
export type BulkProductAction = (typeof BULK_PRODUCT_ACTIONS)[number]

/** Most products one bulk request may touch (one page of the admin list fits). */
export const BULK_PRODUCTS_MAX = 100

const TARGET_STATUS: Record<Exclude<BulkProductAction, 'ARCHIVE'>, ProductStatus> = {
  PUBLISH: ProductStatus.PUBLISHED,
  HIDE: ProductStatus.HIDDEN,
  DRAFT: ProductStatus.DRAFT,
}

export interface BulkCandidate {
  id: number
  status: ProductStatus
  issues: ProductIssue[]
}

export type BulkSkipReason = 'NOT_FOUND' | 'CANNOT_PUBLISH'

export interface BulkPlan {
  /** Status changes to write (archiving has no target status). */
  changes: { id: number; from: ProductStatus; to: ProductStatus | null }[]
  /** Already in the requested status. */
  unchanged: number[]
  skipped: { id: number; reason: BulkSkipReason; issues?: ProductIssue[] }[]
}

/**
 * What a bulk action does to each requested product. Publishing follows the single-product rule: products with a
 * blocking issue are skipped with their issues, never published. Missing or archived ids are reported, not fatal.
 */
export function planBulkAction(ids: number[], found: BulkCandidate[], action: BulkProductAction): BulkPlan {
  const byId = new Map(found.map(candidate => [candidate.id, candidate]))
  const plan: BulkPlan = { changes: [], unchanged: [], skipped: [] }
  for (const id of new Set(ids)) {
    const product = byId.get(id)
    if (!product) {
      plan.skipped.push({ id, reason: 'NOT_FOUND' })
      continue
    }
    if (action === 'ARCHIVE') {
      plan.changes.push({ id, from: product.status, to: null })
      continue
    }
    const to = TARGET_STATUS[action]
    const blockers = product.issues.filter(issue => PUBLISH_BLOCKERS.includes(issue))
    if (product.status === to) plan.unchanged.push(id)
    else if (to === ProductStatus.PUBLISHED && blockers.length)
      plan.skipped.push({ id, reason: 'CANNOT_PUBLISH', issues: blockers })
    else plan.changes.push({ id, from: product.status, to })
  }
  return plan
}
