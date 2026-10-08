import type { Prisma } from '../../generated/prisma/client'
import { Currency } from '../../generated/prisma/enums'
import { PAID_STATUSES } from './analytics-rules'
import type { Window } from './analytics-period'

/** Paid ARS orders whose payment was confirmed in the window (the store's sales). */
export const paidIn = (window: Window): Prisma.OrderWhereInput => ({
  status: { in: PAID_STATUSES },
  currency: Currency.ARS,
  confirmedAt: window,
})

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

/** A product as a stats row shows it: name, first image and whether it was archived. */
export const productSummarySelect = {
  id: true,
  name: true,
  deletedAt: true,
  images: {
    where: { deletedAt: null, file: { deletedAt: null } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
    select: { file: { select: { storageKey: true } } },
  },
} satisfies Prisma.ProductSelect

export type ProductSummary = Prisma.ProductGetPayload<{ select: typeof productSummarySelect }>

/** What a ranking needs to know about each sold variant's product. */
export const soldVariantSelect = {
  id: true,
  product: {
    select: {
      ...productSummarySelect,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.ProductVariantSelect

export type SoldVariant = Prisma.ProductVariantGetPayload<{ select: typeof soldVariantSelect }>
