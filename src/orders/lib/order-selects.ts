import { Prisma } from '../../generated/prisma/client'

/** Internal fields, private tokens and staff notes are deliberately excluded from tracking. */
export const orderSelect = {
  id: true,
  number: true,
  status: true,
  deliveryMethod: true,
  paymentMethod: true,
  currency: true,
  subtotal: true,
  shippingTotal: true,
  total: true,
  placedAt: true,
  expiresAt: true,
  contactEmail: true,
  contactPhone: true,
  items: {
    orderBy: { id: 'asc' },
    select: { productName: true, variantName: true, sku: true, quantity: true, unitPrice: true, lineTotal: true },
  },
  addresses: {
    select: { type: true, name: true, street: true, streetNumber: true, city: true, province: true, postalCode: true },
  },
  statusHistory: { orderBy: { id: 'asc' }, select: { toStatus: true, createdAt: true } },
} satisfies Prisma.OrderSelect

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>
