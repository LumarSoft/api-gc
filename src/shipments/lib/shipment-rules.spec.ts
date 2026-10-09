import { Prisma } from '../../generated/prisma/client'
import { OrderStatus, ShipmentStatus } from '../../generated/prisma/enums'
import { bookingReference, bookingRequest, staleShipmentStatus, syncedShipmentData } from './shipment-rules'
import type { BookingOrder } from './shipment-selects'

const order = (patch: Partial<BookingOrder> = {}): BookingOrder => ({
  id: 1,
  number: 'CG-000123',
  status: OrderStatus.CONFIRMED,
  subtotal: new Prisma.Decimal('15000.5'),
  contactEmail: 'ana@example.test',
  contactPhone: '341555',
  addresses: [
    {
      name: 'Ana',
      taxId: '30111222',
      phone: null,
      street: 'Mitre',
      streetNumber: '1',
      city: 'Córdoba',
      province: 'Córdoba',
      postalCode: '5000',
    },
  ],
  items: [
    {
      quantity: 2,
      variant: {
        id: 7,
        sku: 'T544',
        name: 'Negra',
        weightGrams: 150,
        lengthMm: 60,
        widthMm: 60,
        heightMm: 150,
        isBulky: false,
        product: { name: 'Tinta T544' },
      },
    },
  ],
  shipments: [
    {
      id: 3,
      orderId: 1,
      externalId: null,
      status: ShipmentStatus.PENDING,
      carrier: 'OCA',
      shippedAt: null,
      deliveredAt: null,
      bookingStartedAt: null,
      service: 'Entrega a domicilio',
      carrierId: 208,
      serviceType: 'standard_delivery',
      logisticType: 'carrier_dropoff',
      pickupPointId: null,
      pickupPoint: null,
      cost: new Prisma.Decimal('11800'),
      currency: 'ARS',
    },
  ],
  ...patch,
})

describe('Shipment booking', () => {
  it('books with the chosen option, the order subtotal and the contact phone as fallback', () => {
    const request = bookingRequest(order(), 'CG-000123')
    expect(request).toMatchObject({
      reference: 'CG-000123',
      declaredValue: '15000.50',
      carrierId: 208,
      recipient: { taxId: '30111222', phone: '341555', email: 'ana@example.test' },
    })
    expect('items' in request && request.items).toHaveLength(2)
  })

  it('explains what is missing instead of calling the provider', () => {
    const [address] = order().addresses
    expect(bookingRequest(order({ addresses: [{ ...address, taxId: null }] }), 'CG-000123')).toHaveProperty(
      'error',
      'Faltan datos de quien recibe (dirección, DNI/CUIT o teléfono).',
    )
    const [line] = order().items
    const unmeasured = bookingRequest(
      order({ items: [{ ...line, variant: { ...line.variant, weightGrams: null } }] }),
      'CG-000123',
    )
    expect('error' in unmeasured && unmeasured.error).toMatch(/peso y las medidas/)
  })

  it('stamps the dispatch and delivery dates the first time only', () => {
    const remote = {
      id: '99',
      reference: 'CG-000123',
      status: ShipmentStatus.DELIVERED,
      statusLabel: 'Entregado',
      carrier: 'OCA',
      trackingNumber: '4000',
      trackingUrl: null,
    }
    const now = new Date('2026-10-10T12:00:00Z')
    expect(syncedShipmentData({ shippedAt: null, deliveredAt: null }, remote, now)).toMatchObject({
      externalId: '99',
      status: ShipmentStatus.DELIVERED,
      shippedAt: now,
      deliveredAt: now,
    })
    const earlier = new Date('2026-10-09T12:00:00Z')
    const again = syncedShipmentData({ shippedAt: earlier, deliveredAt: earlier }, remote, now)
    expect(again).not.toHaveProperty('shippedAt')
    expect(again).not.toHaveProperty('deliveredAt')
  })
})

describe('Shipment references and sync order', () => {
  it('numbers the references of bookings made again after a cancellation', () => {
    expect(bookingReference('CG-000123', 1)).toBe('CG-000123')
    expect(bookingReference('CG-000123', 2)).toBe('CG-000123-2')
  })

  it('never moves a finished shipment back to an earlier state', () => {
    expect(staleShipmentStatus(ShipmentStatus.DELIVERED, ShipmentStatus.IN_TRANSIT)).toBe(true)
    expect(staleShipmentStatus(ShipmentStatus.CANCELLED, ShipmentStatus.PENDING)).toBe(true)
    expect(staleShipmentStatus(ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED)).toBe(false)
    expect(staleShipmentStatus(ShipmentStatus.READY_FOR_PICKUP, ShipmentStatus.IN_TRANSIT)).toBe(false)
    expect(staleShipmentStatus(ShipmentStatus.DELIVERED, ShipmentStatus.RETURNED)).toBe(false)
  })
})
