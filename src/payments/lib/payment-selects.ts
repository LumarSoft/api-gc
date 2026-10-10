import { AddressType } from '../../generated/prisma/enums'
import type { Prisma } from '../../generated/prisma/client'

/** What paying an order online needs: its state, the buyer and the snapshot of what is being paid. */
export const payableOrderSelect = {
  id: true,
  number: true,
  status: true,
  paymentMethod: true,
  expiresAt: true,
  total: true,
  shippingTotal: true,
  contactEmail: true,
  items: {
    orderBy: { id: 'asc' },
    select: { sku: true, productName: true, variantName: true, quantity: true, unitPrice: true },
  },
  addresses: { where: { type: AddressType.BILLING }, select: { name: true } },
} satisfies Prisma.OrderSelect

export type PayableOrderRow = Prisma.OrderGetPayload<{ select: typeof payableOrderSelect }>
