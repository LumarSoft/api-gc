import { nextDefault, optionValuesError, pricesError } from './variant-rules'

describe('variant rules', () => {
  it('accepts short option values and rejects empty or too many', () => {
    expect(optionValuesError({ Color: 'Cyan', Capacidad: '70 ml' })).toBeNull()
    expect(optionValuesError(null)).toBeNull()
    expect(optionValuesError({ Color: '' })).toMatch(/name/)
    expect(optionValuesError({ a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' })).toMatch(/up to 5/)
  })

  it('validates prices per list', () => {
    expect(pricesError([{ priceListId: 1, amount: '1000', compareAtAmount: '1200.50' }])).toBeNull()
    expect(pricesError([{ priceListId: 1, amount: '0' }])).toMatch(/greater than zero/)
    expect(pricesError([{ priceListId: 1, amount: '1000', compareAtAmount: '900' }])).toMatch(/crossed-out/)
    expect(
      pricesError([
        { priceListId: 1, amount: '1' },
        { priceListId: 1, amount: '2' },
      ]),
    ).toMatch(/one price per/)
  })

  it('promotes the first active variant when the default is archived, never an inactive one', () => {
    expect(
      nextDefault([
        { id: 2, isActive: false },
        { id: 3, isActive: true },
      ])?.id,
    ).toBe(3)
    expect(nextDefault([{ id: 2, isActive: false }])).toBeUndefined()
    expect(nextDefault([])).toBeUndefined()
  })
})
