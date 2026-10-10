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
    select: {
      productName: true,
      variantName: true,
      sku: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      // Thumbnail only: the product's current first image, like the cart. Name and prices stay the snapshot.
      variant: {
        select: {
          product: {
            select: {
              images: {
                where: { deletedAt: null, file: { deletedAt: null } },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                take: 1,
                select: { file: { select: { storageKey: true } } },
              },
            },
          },
        },
      },
    },
  },
  addresses: {
    select: { type: true, name: true, street: true, streetNumber: true, city: true, province: true, postalCode: true },
  },
  statusHistory: { orderBy: { id: 'asc' }, select: { toStatus: true, createdAt: true } },
  shipments: {
    where: { deletedAt: null },
    orderBy: { id: 'desc' },
    take: 1,
    select: {
      status: true,
      carrier: true,
      service: true,
      carrierStatus: true,
      trackingNumber: true,
      trackingUrl: true,
      pickupPoint: true,
    },
  },
  // The latest payment: the buyer's last Mercado Pago attempt, or the staff confirmation.
  payments: { orderBy: { id: 'desc' }, take: 1, select: { provider: true, status: true, updatedAt: true } },
} satisfies Prisma.OrderSelect

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>

/** Admin view: adds who changed each state and their note, and whether the buyer had an account. */
export const adminOrderSelect = {
  ...orderSelect,
  userId: true,
  statusHistory: {
    orderBy: { id: 'asc' },
    select: { toStatus: true, createdAt: true, note: true, changedBy: { select: { firstName: true, lastName: true } } },
  },
  shipments: {
    ...orderSelect.shipments,
    select: { ...orderSelect.shipments.select, externalId: true, logisticType: true },
  },
  // Every payment, so staff see the Mercado Pago operations and any that must be given back (an order has a few).
  payments: {
    orderBy: { id: 'desc' },
    take: 20,
    select: { ...orderSelect.payments.select, externalId: true, amount: true, externalStatusDetail: true },
  },
} satisfies Prisma.OrderSelect

export type AdminOrderRow = Prisma.OrderGetPayload<{ select: typeof adminOrderSelect }>
