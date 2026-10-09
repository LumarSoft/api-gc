import { Prisma } from '../../generated/prisma/client'
import { OrderStatus, ShipmentStatus } from '../../generated/prisma/enums'
import { bookingRequest, syncedShipmentData } from './shipment-rules'
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
      carrierId: 208,
      serviceType: 'standard_delivery',
      logisticType: 'carrier_dropoff',
      pickupPointId: null,
    },
  ],
  ...patch,
})

describe('Shipment booking', () => {
  it('books with the chosen option, the order subtotal and the contact phone as fallback', () => {
    const request = bookingRequest(order())
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
    expect(bookingRequest(order({ addresses: [{ ...address, taxId: null }] }))).toHaveProperty(
      'error',
      'Faltan datos de quien recibe (dirección, DNI/CUIT o teléfono).',
    )
    const [line] = order().items
    const unmeasured = bookingRequest(order({ items: [{ ...line, variant: { ...line.variant, weightGrams: null } }] }))
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
      cost: '12000.00',
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
