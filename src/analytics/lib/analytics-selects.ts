import type { Prisma } from '../../generated/prisma/client'

export const paidOrderSelect = {
  placedAt: true,
  confirmedAt: true,
  subtotal: true,
  discountTotal: true,
  shippingTotal: true,
  total: true,
  contactEmail: true,
  buyerType: true,
  paymentMethod: true,
  deliveryMethod: true,
} satisfies Prisma.OrderSelect

/** What a ranking needs to know about each sold variant's product. */
export const soldVariantSelect = {
  id: true,
  product: {
    select: {
      id: true,
      name: true,
      deletedAt: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
      images: {
        where: { deletedAt: null, file: { deletedAt: null } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { file: { select: { storageKey: true } } },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect

export type SoldVariant = Prisma.ProductVariantGetPayload<{ select: typeof soldVariantSelect }>
