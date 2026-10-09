import { Prisma } from '../../generated/prisma/client'
import { Currency, DeliveryMethod } from '../../generated/prisma/enums'
import {
  checkoutDeliveryOptions,
  checkoutTotal,
  deliveryInputError,
  isRosarioAddress,
  type ShippingConfiguration,
} from './checkout-delivery'

const money = (amount: string) => ({ amount, currency: Currency.ARS })
const noCarrier = { enabled: false, reason: 'No disponible.', cost: null }
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
    const options = checkoutDeliveryOptions([], money('100000.00'), noCarrier)
    expect(options[0].cost).toEqual(money('0.00'))
    expect(options.slice(1).every(option => !option.enabled && option.cost === null)).toBe(true)
  })

  it('applies the configured free-shipping threshold at its exact decimal boundary', () => {
    expect(checkoutDeliveryOptions([local], money('99999.99'), noCarrier)[1].cost).toEqual(money('2500.25'))
    expect(checkoutDeliveryOptions([local], money('100000.00'), noCarrier)[1].cost).toEqual(money('0.00'))
    expect(
      checkoutDeliveryOptions([{ ...local, freeShippingThreshold: null }], money('200000.00'), noCarrier)[1].cost,
    ).toEqual(money('2500.25'))
  })

  it.each([
    { isActive: false },
    { currency: Currency.USD },
    { flatRate: null },
    { flatRate: new Prisma.Decimal('-1') },
    { freeShippingThreshold: new Prisma.Decimal('-1') },
  ])('rejects unusable configuration %j', patch => {
    expect(checkoutDeliveryOptions([{ ...local, ...patch }], money('100000.00'), noCarrier)[1].enabled).toBe(false)
  })

  it('allows a configured zero flat rate', () => {
    expect(
      checkoutDeliveryOptions([{ ...local, flatRate: new Prisma.Decimal(0) }], money('1.00'), noCarrier)[1].cost,
    ).toEqual(money('0.00'))
  })

  it('offers the carrier only when the cart can be quoted, priced with the chosen quote', () => {
    expect(checkoutDeliveryOptions([], money('1.00'), noCarrier)[2]).toMatchObject({
      enabled: false,
      cost: null,
      unavailableReason: 'No disponible.',
    })
    const carrier = { enabled: true, reason: null, cost: money('12143.00') }
    expect(checkoutDeliveryOptions([], money('1.00'), carrier)[2]).toMatchObject({
      enabled: true,
      cost: money('12143.00'),
      unavailableReason: null,
    })
  })

  it('asks carrier buyers for the address, document, phone and a chosen quote', () => {
    const address = { street: 'Mitre', streetNumber: '1', city: 'Córdoba', province: 'Córdoba', postalCode: '5000' }
    const base = { name: 'A', email: 'a@example.test', deliveryMethod: DeliveryMethod.CARRIER }
    expect(deliveryInputError(base)).toBe('Completá la dirección de envío.')
    expect(deliveryInputError({ ...base, shippingAddress: address })).toMatch(/DNI o CUIT/)
    const complete = { ...base, shippingAddress: { ...address, taxId: '30111222' } }
    expect(deliveryInputError(complete)).toMatch(/teléfono/)
    expect(deliveryInputError({ ...complete, phone: '341' })).toBe('Elegí una opción de envío.')
    const withCuit = (taxId: string) =>
      deliveryInputError({ ...complete, phone: '341', shippingQuoteId: 3, shippingAddress: { ...address, taxId } })
    expect(withCuit('20123456786')).toBeNull()
    expect(withCuit('20123456787')).toMatch(/CUIT/)
    expect(deliveryInputError({ ...complete, phone: '341', shippingQuoteId: 3 })).toBeNull()
    expect(
      deliveryInputError({ ...base, deliveryMethod: DeliveryMethod.LOCAL_DELIVERY, shippingAddress: address }),
    ).toMatch(/Rosario/)
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
