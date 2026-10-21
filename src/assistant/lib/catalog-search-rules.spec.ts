import type { ProductSummaryDto } from '../../products/dto/product-response.dto'
import { priceLabel, productLine, withinBudget } from './catalog-search-rules'

describe('catalog search rules', () => {
  it('formats prices like the store', () => {
    expect(priceLabel({ amount: '419999.00', currency: 'ARS' })).toMatch(/^\$\s?419\.999$/)
    expect(priceLabel({ amount: '1490.00', currency: 'USD' })).toMatch(/^US\$\s?1\.490$/)
    expect(priceLabel(null)).toBeNull()
  })

  it('compares budgets only against prices in pesos', () => {
    expect(withinBudget({ amount: '400000.00', currency: 'ARS' }, 500_000)).toBe(true)
    expect(withinBudget({ amount: '600000.00', currency: 'ARS' }, 500_000)).toBe(false)
    expect(withinBudget({ amount: '100.00', currency: 'USD' }, 500_000)).toBe(false)
    expect(withinBudget(null, null)).toBe(true)
  })

  it('describes a product in one short line for the model', () => {
    const product: ProductSummaryDto = {
      id: 1,
      slug: 'ecotank-l3250',
      name: 'EcoTank L3250',
      shortDescription: 'Multifuncional con wifi',
      brand: { name: 'Epson', slug: 'epson' },
      category: { name: 'Para el hogar', slug: 'impresoras-hogar' },
      imageUrl: null,
      price: { amount: '419999.00', currency: 'ARS' },
      compareAtPrice: { amount: '459999.00', currency: 'ARS' },
      badge: 'OFFER',
      isFeatured: false,
      availability: 'LOW_STOCK',
      outOfStockBehavior: 'SHOW_UNAVAILABLE',
      variantCount: 1,
    }
    expect(productLine(product)).toEqual({
      slug: 'ecotank-l3250',
      name: 'EcoTank L3250',
      category: 'Para el hogar',
      summary: 'Multifuncional con wifi',
      price: expect.stringMatching(/419\.999/) as string,
      previousPrice: expect.stringMatching(/459\.999/) as string,
      availability: 'pocas unidades',
    })
    expect(productLine({ ...product, badge: null, variantCount: 4 })).toMatchObject({ options: 4 })
    expect(productLine({ ...product, badge: null })).not.toHaveProperty('previousPrice')
  })
})
