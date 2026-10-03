import { Prisma } from '../../generated/prisma/client'

/** Fields needed to render a product card. Prices are limited to the price lists of the current buyer. */
export function summarySelect(priceListIds: number[]) {
  return {
    id: true,
    slug: true,
    name: true,
    shortDescription: true,
    isFeatured: true,
    outOfStockBehavior: true,
    publishedAt: true,
    brand: { select: { name: true, slug: true } },
    category: { select: { name: true, slug: true } },
    images: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 1,
      select: { file: { select: { storageKey: true } } },
    },
    variants: {
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        prices: {
          where: { deletedAt: null, priceListId: { in: priceListIds } },
          select: { priceListId: true, amount: true, currency: true, compareAtAmount: true },
        },
        inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
      },
    },
  } satisfies Prisma.ProductSelect
}

/** Everything the product page needs, on top of the card fields. */
export function detailSelect(priceListIds: number[]) {
  const summary = summarySelect(priceListIds)
  const relatedSummary = { select: { ...summary, status: true, deletedAt: true } }

  return {
    ...summary,
    description: true,
    warrantyMonths: true,
    seoTitle: true,
    seoDescription: true,
    category: { select: { name: true, slug: true, parent: { select: { name: true, slug: true } } } },
    images: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { altText: true, variantId: true, file: { select: { storageKey: true } } },
    },
    variants: {
      where: { deletedAt: null, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      select: {
        ...summary.variants.select,
        sku: true,
        name: true,
        optionValues: true,
        isDefault: true,
        saleUnit: true,
        unitsPerSaleUnit: true,
      },
    },
    specifications: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { groupName: true, name: true, value: true },
    },
    tags: { select: { tag: { select: { name: true, slug: true, group: true, deletedAt: true } } } },
    compatibleWith: { select: { targetProduct: relatedSummary } },
    compatibleConsumables: { select: { product: relatedSummary } },
  } satisfies Prisma.ProductSelect
}

export type SummaryRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof summarySelect> }>
export type DetailRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof detailSelect> }>
