import { Prisma } from '../../generated/prisma/client'

/** Variant fields the admin needs to judge a product: state, retail price and stock. */
function variantSelect(retailListId: number | null) {
  return {
    id: true,
    sku: true,
    name: true,
    isDefault: true,
    isActive: true,
    prices: {
      // Without a retail list (not set up yet) no price row can match.
      where: { deletedAt: null, priceListId: retailListId ?? -1 },
      select: { amount: true, currency: true },
    },
    inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
  } satisfies Prisma.ProductVariantSelect
}

const VARIANT_ORDER = [{ isDefault: 'desc' as const }, { id: 'asc' as const }]

/** One row of the admin product list. */
export function adminListSelect(retailListId: number | null) {
  return {
    id: true,
    name: true,
    slug: true,
    status: true,
    isFeatured: true,
    outOfStockBehavior: true,
    publishedAt: true,
    updatedAt: true,
    category: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    images: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 1,
      select: { file: { select: { storageKey: true } } },
    },
    _count: { select: { images: { where: { deletedAt: null } } } },
    variants: { where: { deletedAt: null }, orderBy: VARIANT_ORDER, select: variantSelect(retailListId) },
  } satisfies Prisma.ProductSelect
}

/** Everything the admin product editor shows. */
export function adminDetailSelect(retailListId: number | null) {
  return {
    ...adminListSelect(retailListId),
    type: true,
    shortDescription: true,
    description: true,
    warrantyMonths: true,
    seoTitle: true,
    seoDescription: true,
    createdAt: true,
    images: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, fileId: true, altText: true, variantId: true, file: { select: { storageKey: true } } },
    },
    specifications: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, groupName: true, name: true, value: true },
    },
    tags: {
      where: { tag: { deletedAt: null } },
      orderBy: { tag: { name: 'asc' } },
      select: { tag: { select: { id: true, name: true, slug: true, group: true } } },
    },
  } satisfies Prisma.ProductSelect
}

export type AdminListRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof adminListSelect> }>
export type AdminDetailRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof adminDetailSelect> }>
export type AdminVariantRow = AdminListRow['variants'][number]
