import {
  copyCandidates,
  copyName,
  numberedCandidates,
  productIssues,
  publishBlockerMessage,
} from './admin-product-rules'

describe('admin product rules', () => {
  it('lists what a product still needs', () => {
    expect(productIssues({ imageCount: 2, activeVariants: [{ hasRetailPrice: true }] })).toEqual([])
    expect(productIssues({ imageCount: 0, activeVariants: [] })).toEqual(['NO_ACTIVE_VARIANT', 'NO_IMAGE'])
    expect(productIssues({ imageCount: 1, activeVariants: [{ hasRetailPrice: false }] })).toEqual(['NO_RETAIL_PRICE'])
  })

  it('blocks publishing without an active priced variant, but only warns about images', () => {
    expect(publishBlockerMessage(['NO_IMAGE'])).toBeNull()
    expect(publishBlockerMessage(['NO_RETAIL_PRICE', 'NO_IMAGE'])).toBe(
      'Cannot publish: no active variant has a retail price',
    )
    expect(publishBlockerMessage(['NO_ACTIVE_VARIANT'])).toMatch(/no active variant$/)
  })

  it('names copies and builds unique identifiers within the column length', () => {
    expect(copyName('Epson L3250')).toBe('Epson L3250 (copia)')
    expect(copyName('x'.repeat(200))).toHaveLength(200)
    expect(copyCandidates('l3250', 'copia', 220, 3)).toEqual(['l3250-copia', 'l3250-copia-2', 'l3250-copia-3'])
    expect(copyCandidates('C13T544', 'COPIA', 60, 1)).toEqual(['C13T544-COPIA'])
    expect(copyCandidates('A'.repeat(60), 'COPIA', 60, 2).every(sku => sku.length <= 60)).toBe(true)
  })

  it('numbers slugs of new products named like existing ones', () => {
    expect(numberedCandidates('epson-l3250', 220, 3)).toEqual(['epson-l3250', 'epson-l3250-2', 'epson-l3250-3'])
    expect(numberedCandidates('a'.repeat(220), 220, 2).every(slug => slug.length <= 220)).toBe(true)
  })
})
