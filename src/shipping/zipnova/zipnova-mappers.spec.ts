import { ShipmentStatus } from '../../generated/prisma/enums'
import { carrierShipment, quoteBody, quoteOptions, shipmentBody, shipmentStatus } from './zipnova-mappers'
import type { ZipnovaQuoteResult } from './zipnova-types'

const result = (patch: Partial<ZipnovaQuoteResult> = {}): ZipnovaQuoteResult => ({
  selectable: true,
  logistic_type: 'carrier_dropoff',
  carrier: { id: 208, name: 'OCA' },
  service_type: { code: 'standard_delivery', name: 'Entrega a domicilio' },
  delivery_time: { min: 4, max: 5 },
  amounts: { price_incl_tax: 12143, seller_price_incl_tax: 12143.5 },
  ...patch,
})
const item = { sku: 'T544', description: 'Tinta', weightGrams: 150, heightCm: 15, widthCm: 6, lengthCm: 6 }

describe('Zipnova mapping', () => {
  it('groups every documented status code and treats unknown ones as in transit', () => {
    expect(shipmentStatus('documentation_ready')).toBe(ShipmentStatus.PENDING)
    expect(shipmentStatus('out_for_delivery')).toBe(ShipmentStatus.IN_TRANSIT)
    expect(shipmentStatus('available_for_pickup')).toBe(ShipmentStatus.READY_FOR_PICKUP)
    expect(shipmentStatus('delivered_with_damage')).toBe(ShipmentStatus.DELIVERED)
    expect(shipmentStatus('returned_to_seller')).toBe(ShipmentStatus.RETURNED)
    expect(shipmentStatus('expired')).toBe(ShipmentStatus.CANCELLED)
    expect(shipmentStatus('lost_in_carrier')).toBe(ShipmentStatus.LOST)
    expect(shipmentStatus('something_new')).toBe(ShipmentStatus.IN_TRANSIT)
  })

  it('drops branch delivery without branches, which could not be booked', () => {
    const branchless = result({ service_type: { code: 'pickup_point', name: 'Sucursal' }, pickup_points: [] })
    expect(quoteOptions({ results: { pickup_point: branchless } })).toEqual([])
    expect(quoteOptions(null)).toEqual([])
  })

  it('sends Zipnova at least its minimum item weight', () => {
    const body = quoteBody(1, 2, {
      destination: { postalCode: '1414', city: 'CABA', province: 'Capital Federal' },
      items: [{ ...item, weightGrams: 3 }],
      declaredValue: '10.00',
    }) as { items: { weight: number }[] }
    expect(body.items[0].weight).toBe(10)
  })

  it('keeps the winning option per delivery mode, its branches and prices as decimal strings', () => {
    const options = quoteOptions({
      results: {
        standard_delivery: result(),
        pickup_point: result({
          service_type: { code: 'pickup_point', name: 'Entrega en punto de entrega' },
          pickup_points: [
            {
              point_id: 220,
              description: 'Punto Oca - Copyshop',
              location: { street: 'Cordoba', street_number: '4463', city: 'Villa Crespo', state: 'Capital Federal' },
            },
          ],
        }),
        express_delivery: result({ selectable: false }),
      },
    })
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ carrierId: 208, price: '12143.00', cost: '12143.50', minDays: 4, maxDays: 5 })
    expect(options[1].pickupPoints).toEqual([
      { id: 220, description: 'Punto Oca - Copyshop — Cordoba 4463, Villa Crespo, Capital Federal' },
    ])
    expect(quoteOptions({ results: null })).toEqual([])
  })

  it('sends one item per unit with our account, origin and source', () => {
    const body = quoteBody(11600, 375310, {
      destination: { postalCode: '1414', city: 'CABA', province: 'Capital Federal' },
      items: [item, item],
      declaredValue: '15000.50',
    }) as Record<string, unknown>
    expect(body).toMatchObject({
      account_id: 11600,
      origin_id: 375310,
      declared_value: 15000.5,
      type_packaging: 'dynamic',
    })
    expect(body.items).toHaveLength(2)
    expect(body.destination).toEqual({ zipcode: '1414', city: 'CABA', state: 'Capital Federal' })
  })

  it('books branch delivery with the chosen branch and home delivery without one', () => {
    const request = {
      reference: 'CG-000123',
      declaredValue: '100.00',
      items: [item],
      carrierId: 208,
      serviceType: 'pickup_point',
      logisticType: 'carrier_dropoff',
      pickupPointId: 220,
      recipient: {
        name: 'Ana',
        taxId: '30111222',
        email: 'ana@example.test',
        phone: '341555',
        street: 'Mitre',
        streetNumber: '1',
        city: 'Córdoba',
        province: 'Córdoba',
        postalCode: '5000',
      },
    }
    const branch = shipmentBody(1, 2, request) as { external_id: string; destination: Record<string, unknown> }
    expect(branch.external_id).toBe('CG-000123')
    expect(branch.destination).toMatchObject({ point_id: 220, document: '30111222', zipcode: '5000' })
    const home = shipmentBody(1, 2, { ...request, pickupPointId: null }) as { destination: Record<string, unknown> }
    expect(home.destination).not.toHaveProperty('point_id')
  })

  it('maps a shipment to our shape', () => {
    expect(
      carrierShipment({
        id: 3850099,
        external_id: 'CG-000123',
        status: 'in_transit',
        status_name: 'En camino',
        carrier: { name: 'OCA' },
        carrier_tracking_id: '4000123',
        tracking: 'https://zipnova.example/t/1',
      }),
    ).toEqual({
      id: '3850099',
      reference: 'CG-000123',
      status: ShipmentStatus.IN_TRANSIT,
      statusLabel: 'En camino',
      carrier: 'OCA',
      trackingNumber: '4000123',
      trackingUrl: 'https://zipnova.example/t/1',
    })
  })
})
