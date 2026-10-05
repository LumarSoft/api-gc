import { Prisma } from '../../generated/prisma/client'
import { Currency, DeliveryMethod } from '../../generated/prisma/enums'
import {
  checkoutDeliveryOptions,
  checkoutTotal,
  isRosarioAddress,
  type ShippingConfiguration,
} from './checkout-delivery'

const money = (amount: string) => ({ amount, currency: Currency.ARS })
const local: ShippingConfiguration = {
  code: DeliveryMethod.LOCAL_DELIVERY,
  name: 'Local',
  description: null,
  isActive: true,
  currency: Currency.ARS,
  flatRate: new Prisma.Decimal('2500.25'),
  freeShippingThreshold: new Prisma.Decimal('100000.00'),
}

describe('Checkout delivery', () => {
  it('keeps pickup free and never invents a local rate or carrier quote', () => {
    const options = checkoutDeliveryOptions([], money('100000.00'))
    expect(options[0].cost).toEqual(money('0.00'))
    expect(options.slice(1).every(option => !option.enabled && option.cost === null)).toBe(true)
  })

  it('applies the configured free-shipping threshold at its exact decimal boundary', () => {
    expect(checkoutDeliveryOptions([local], money('99999.99'))[1].cost).toEqual(money('2500.25'))
    expect(checkoutDeliveryOptions([local], money('100000.00'))[1].cost).toEqual(money('0.00'))
    expect(checkoutDeliveryOptions([{ ...local, freeShippingThreshold: null }], money('200000.00'))[1].cost).toEqual(
      money('2500.25'),
    )
  })

  it.each([
    { isActive: false },
    { currency: Currency.USD },
    { flatRate: null },
    { flatRate: new Prisma.Decimal('-1') },
    { freeShippingThreshold: new Prisma.Decimal('-1') },
  ])('rejects unusable configuration %j', patch => {
    expect(checkoutDeliveryOptions([{ ...local, ...patch }], money('100000.00'))[1].enabled).toBe(false)
  })

  it('allows a configured zero flat rate', () => {
    expect(checkoutDeliveryOptions([{ ...local, flatRate: new Prisma.Decimal(0) }], money('1.00'))[1].cost).toEqual(
      money('0.00'),
    )
  })

  it('calculates exact totals and refuses incomplete or mixed-currency amounts', () => {
    expect(checkoutTotal(money('0.10'), money('0.20'))).toEqual(money('0.30'))
    expect(checkoutTotal(null, money('0.00'))).toBeNull()
    expect(checkoutTotal(money('1.00'), null)).toBeNull()
    expect(checkoutTotal({ amount: '1.00', currency: Currency.USD }, money('0.00'))).toBeNull()
  })

  it('checks the local destination independently from postal code', () => {
    expect(isRosarioAddress(' Rosario ', 'SANTA FE')).toBe(true)
    expect(isRosarioAddress('Córdoba', 'Córdoba')).toBe(false)
    expect(isRosarioAddress('Rosario', 'Buenos Aires')).toBe(false)
  })
})
