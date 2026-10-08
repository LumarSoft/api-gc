import { ProductStatus } from '../../generated/prisma/enums'
import { planBulkAction, type BulkCandidate } from './bulk-product-rules'

const ready: BulkCandidate = { id: 1, status: ProductStatus.DRAFT, issues: ['NO_IMAGE'] }
const noPrice: BulkCandidate = { id: 2, status: ProductStatus.DRAFT, issues: ['NO_RETAIL_PRICE', 'NO_IMAGE'] }
const live: BulkCandidate = { id: 3, status: ProductStatus.PUBLISHED, issues: [] }

describe('bulk product actions', () => {
  it('publishes only products without a blocking issue; a missing image only warns', () => {
    expect(planBulkAction([1, 2, 3], [ready, noPrice, live], 'PUBLISH')).toEqual({
      changes: [{ id: 1, from: ProductStatus.DRAFT, to: ProductStatus.PUBLISHED }],
      unchanged: [3],
      skipped: [{ id: 2, reason: 'CANNOT_PUBLISH', issues: ['NO_RETAIL_PRICE'] }],
    })
  })
  it('hides or drafts regardless of issues', () => {
    expect(planBulkAction([2, 3], [noPrice, live], 'HIDE').changes.map(change => change.to)).toEqual([
      ProductStatus.HIDDEN,
      ProductStatus.HIDDEN,
    ])
    expect(planBulkAction([1], [ready], 'DRAFT').unchanged).toEqual([1])
  })
  it('archives every found product and reports missing ids once', () => {
    expect(planBulkAction([3, 9, 9], [live], 'ARCHIVE')).toEqual({
      changes: [{ id: 3, from: ProductStatus.PUBLISHED, to: null }],
      unchanged: [],
      skipped: [{ id: 9, reason: 'NOT_FOUND' }],
    })
  })
})
