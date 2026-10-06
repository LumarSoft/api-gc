import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { Currency, ProductStatus } from '../generated/prisma/enums'
import { PricingService } from '../pricing/pricing.service'
import { CartMapper } from './cart.mapper'
import type { CartVariantRow } from './lib/cart-selects'

describe('Cart prices and availability', () => {
  const pricing = new PricingService({} as never)
  const mapper = new CartMapper(pricing, { publicUrl: (key: string) => `/files/${key}` } as FilesService)
  const context = { priceListIds: [1], usdRate: new Prisma.Decimal('1234.5678') }
  const variant: CartVariantRow = {
    id: 1,
    sku: 'CART-TEST',
    name: null,
    isActive: true,
    deletedAt: null,
    product: {
      name: 'Test product',
      slug: 'test-product',
      status: ProductStatus.PUBLISHED,
      deletedAt: null,
      images: [],
    },
    inventory: { onHand: 20, reserved: 2, deletedAt: null },
    prices: [{ priceListId: 1, amount: new Prisma.Decimal('0.10'), currency: Currency.ARS, compareAtAmount: null }],
  }

  it('multiplies and sums decimals without float rounding errors', () => {
    const response = mapper.response([mapper.item(variant, 3, context), mapper.item(variant, 7, context)])
    expect(response.items[0].total?.amount).toBe('0.30')
    expect(response.subtotal?.amount).toBe('1.00')
  })

  it('converts USD using the shared pricing service and rounds the unit price before multiplying', () => {
    const item = mapper.item({ ...variant, prices: [{ ...variant.prices[0], currency: Currency.USD }] }, 3, context)
    expect(item.unitPrice).toEqual({ amount: '123.46', currency: Currency.ARS })
    expect(item.total?.amount).toBe('370.38')
  })

  it('does not mix USD with ARS when the exchange rate is missing', () => {
    const item = mapper.item({ ...variant, prices: [{ ...variant.prices[0], currency: Currency.USD }] }, 1, {
      ...context,
      usdRate: null,
    })
    expect(item.issue).toBe('NO_EXCHANGE_RATE')
    expect(mapper.response([item, mapper.item(variant, 1, context)]).subtotal).toBeNull()
  })

  it('keeps a removed price visible as an issue and never returns a partial subtotal', () => {
    const item = mapper.item({ ...variant, prices: [] }, 1, context)
    expect(item.issue).toBe('NO_PRICE')
    expect(mapper.response([mapper.item(variant, 1, context), item]).subtotal).toBeNull()
  })

  it('uses physical stock minus reservations and flags a changed stock level', () => {
    const item = mapper.item(variant, 19, context)
    expect(item.availableQuantity).toBe(18)
    expect(item.issue).toBe('INSUFFICIENT_STOCK')
  })

  it('keeps archived products in the cart so the buyer can remove them', () => {
    const item = mapper.item({ ...variant, product: { ...variant.product, deletedAt: new Date() } }, 1, context)
    expect(item.issue).toBe('UNAVAILABLE')
    expect(item.total).toBeNull()
  })
})
