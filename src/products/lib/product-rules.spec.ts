import { Currency } from '../../generated/prisma/enums'
import { availabilityOf, badgeOf, bestAvailability, compareByPrice, groupSpecifications } from './product-rules'

const ars = (amount: string) => ({ amount, currency: Currency.ARS })

describe('product rules', () => {
  it('computes availability from on-hand minus reserved, with the default or own threshold', () => {
    expect(availabilityOf(null)).toBe('OUT_OF_STOCK')
    expect(availabilityOf({ onHand: 5, reserved: 5, lowStockThreshold: null })).toBe('OUT_OF_STOCK')
    expect(availabilityOf({ onHand: 5, reserved: 2, lowStockThreshold: null })).toBe('LOW_STOCK')
    expect(availabilityOf({ onHand: 20, reserved: 2, lowStockThreshold: null })).toBe('IN_STOCK')
    expect(availabilityOf({ onHand: 20, reserved: 2, lowStockThreshold: 20 })).toBe('LOW_STOCK')
  })

  it('uses the best variant for the product availability', () => {
    expect(bestAvailability(['OUT_OF_STOCK', 'LOW_STOCK'])).toBe('LOW_STOCK')
    expect(bestAvailability(['OUT_OF_STOCK', 'IN_STOCK'])).toBe('IN_STOCK')
    expect(bestAvailability([])).toBe('OUT_OF_STOCK')
  })

  it('prefers OFFER over NEW and expires NEW after 45 days', () => {
    const now = new Date('2026-10-04T00:00:00Z')
    const recent = new Date('2026-09-30T00:00:00Z')
    const old = new Date('2026-07-01T00:00:00Z')
    expect(badgeOf({ price: ars('90'), compareAtPrice: ars('100') }, recent, now)).toBe('OFFER')
    expect(badgeOf({ price: ars('90'), compareAtPrice: null }, recent, now)).toBe('NEW')
    expect(badgeOf({ price: ars('90'), compareAtPrice: null }, old, now)).toBeNull()
  })

  it('sorts by price in both directions and always leaves products without price last', () => {
    const items = [{ price: ars('300') }, { price: null }, { price: ars('100') }]
    expect([...items].sort((a, b) => compareByPrice(a, b, 1)).map(item => item.price?.amount)).toEqual([
      '100',
      '300',
      undefined,
    ])
    expect([...items].sort((a, b) => compareByPrice(a, b, -1)).map(item => item.price?.amount)).toEqual([
      '300',
      '100',
      undefined,
    ])
  })

  it('groups specifications keeping their order', () => {
    const groups = groupSpecifications([
      { groupName: 'Imprimir', name: 'Tecnología', value: 'Inyección' },
      { groupName: 'General', name: 'Peso', value: '3,9 kg' },
      { groupName: 'Imprimir', name: 'Resolución', value: '5.760 dpi' },
    ])
    expect(groups.map(group => [group.group, group.items.length])).toEqual([
      ['Imprimir', 2],
      ['General', 1],
    ])
  })
})
