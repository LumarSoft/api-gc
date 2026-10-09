import { Prisma } from '../../generated/prisma/client'

/** Fields the provider sync reads and updates. */
export const syncedShipmentSelect = {
  id: true,
  orderId: true,
  externalId: true,
  status: true,
  carrier: true,
  shippedAt: true,
  deliveredAt: true,
} satisfies Prisma.ShipmentSelect

export type SyncedShipment = Prisma.ShipmentGetPayload<{ select: typeof syncedShipmentSelect }>

/** Everything needed to book an order's shipment at the provider. */
export const bookingOrderSelect = {
  id: true,
  number: true,
  status: true,
  subtotal: true,
  contactEmail: true,
  contactPhone: true,
  addresses: {
    where: { type: 'SHIPPING' },
    select: {
      name: true,
      taxId: true,
      phone: true,
      street: true,
      streetNumber: true,
      city: true,
      province: true,
      postalCode: true,
    },
  },
  items: {
    orderBy: { id: 'asc' },
    select: {
      quantity: true,
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          weightGrams: true,
          lengthMm: true,
          widthMm: true,
          heightMm: true,
          isBulky: true,
          product: { select: { name: true } },
        },
      },
    },
  },
  shipments: {
    where: { deletedAt: null },
    orderBy: { id: 'desc' },
    take: 1,
    select: {
      ...syncedShipmentSelect,
      bookingStartedAt: true,
      service: true,
      carrierId: true,
      serviceType: true,
      logisticType: true,
      pickupPointId: true,
      pickupPoint: true,
      cost: true,
      currency: true,
    },
  },
} satisfies Prisma.OrderSelect

export type BookingOrder = Prisma.OrderGetPayload<{ select: typeof bookingOrderSelect }>
export type BookingShipment = BookingOrder['shipments'][number]
