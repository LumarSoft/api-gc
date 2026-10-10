import {
  MAX_QUOTED_UNITS,
  carrierItems,
  hasShippingData,
  itemsHash,
  sameDestination,
  shippabilityIssue,
} from './shipping-rules'

const variant = {
  id: 1,
  sku: 'T544',
  weightGrams: 150,
  lengthMm: 61,
  widthMm: 60,
  heightMm: 150,
}

describe('Shipping rules', () => {
  it('identifies the cart contents regardless of line order', () => {
    const a = itemsHash([
      { variantId: 2, quantity: 1 },
      { variantId: 1, quantity: 3 },
    ])
    expect(
      itemsHash([
        { variantId: 1, quantity: 3 },
        { variantId: 2, quantity: 1 },
      ]),
    ).toBe(a)
    expect(itemsHash([{ variantId: 1, quantity: 4 }])).not.toBe(a)
  })

  it('quotes every measured cart up to the unit limit', () => {
    const line = { variantId: 1, quantity: 1 }
    expect(shippabilityIssue([line], [variant])).toBeNull()
    expect(shippabilityIssue([{ ...line, quantity: MAX_QUOTED_UNITS }], [variant])).toBeNull()
    expect(shippabilityIssue([line], [{ ...variant, weightGrams: null }])).toBe('MISSING_MEASUREMENTS')
    expect(shippabilityIssue([line], [{ ...variant, heightMm: 0 }])).toBe('MISSING_MEASUREMENTS')
    expect(shippabilityIssue([{ variantId: 9, quantity: 1 }], [variant])).toBe('MISSING_MEASUREMENTS')
    expect(shippabilityIssue([{ ...line, quantity: MAX_QUOTED_UNITS + 1 }], [variant])).toBe('TOO_MANY_UNITS')
  })

  it('sends one item per unit, described by its SKU, with whole centimeters rounded up', () => {
    const items = carrierItems([{ variantId: 1, quantity: 2 }], [variant])
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      sku: 'T544',
      description: 'T544',
      weightGrams: 150,
      heightCm: 15,
      widthCm: 6,
      lengthCm: 7,
    })
  })

  it('compares destinations ignoring accents, case and spaces', () => {
    const quoted = { postalCode: '5000', city: 'Córdoba', province: 'Córdoba' }
    expect(sameDestination(quoted, { postalCode: ' 5000', city: 'cordoba', province: 'CÓRDOBA ' })).toBe(true)
    expect(sameDestination(quoted, { ...quoted, postalCode: '5001' })).toBe(false)
  })

  it('needs weight and all three measurements above zero', () => {
    expect(hasShippingData(variant)).toBe(true)
    expect(hasShippingData({ ...variant, lengthMm: null })).toBe(false)
    expect(hasShippingData({ ...variant, weightGrams: 0 })).toBe(false)
  })
})
