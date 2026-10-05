import { Prisma } from '../../generated/prisma/client'
import { Currency, DeliveryMethod } from '../../generated/prisma/enums'
import type { MoneyDto } from '../../pricing/pricing.service'
import type { CheckoutDeliveryDto } from '../dto/checkout-response.dto'

export type ShippingConfiguration = {
  code: DeliveryMethod
  name: string
  description: string | null
  isActive: boolean
  currency: Currency
  flatRate: Prisma.Decimal | null
  freeShippingThreshold: Prisma.Decimal | null
}

export function checkoutDeliveryOptions(
  config: ShippingConfiguration[],
  subtotal: MoneyDto | null,
): CheckoutDeliveryDto[] {
  const local = config.find(method => method.code === DeliveryMethod.LOCAL_DELIVERY)
  const configured = Boolean(
    local?.isActive &&
    local.currency === Currency.ARS &&
    local.flatRate &&
    local.flatRate.gte(0) &&
    (!local.freeShippingThreshold || local.freeShippingThreshold.gte(0)),
  )
  const free =
    configured &&
    subtotal &&
    local?.freeShippingThreshold &&
    new Prisma.Decimal(subtotal.amount).gte(local.freeShippingThreshold)
  return [
    {
      code: DeliveryMethod.STORE_PICKUP,
      name: 'Retiro en el local',
      description: 'Retirá tu compra en Rosario, sin costo de envío.',
      enabled: true,
      cost: { amount: '0.00', currency: Currency.ARS },
      unavailableReason: null,
    },
    {
      code: DeliveryMethod.LOCAL_DELIVERY,
      name: local?.name ?? 'Entrega en Rosario',
      description: local?.description ?? 'Entrega a domicilio dentro de Rosario.',
      enabled: configured,
      cost: configured ? { amount: free ? '0.00' : local!.flatRate!.toFixed(2), currency: Currency.ARS } : null,
      unavailableReason: configured ? null : 'La entrega a domicilio todavía no está disponible.',
    },
    {
      code: DeliveryMethod.CARRIER,
      name: 'Envío al resto del país',
      description: 'El costo depende del destino y de los productos.',
      enabled: false,
      cost: null,
      unavailableReason: 'La cotización de envíos todavía no está disponible.',
    },
  ]
}

export function checkoutTotal(subtotal: MoneyDto | null, shipping: MoneyDto | null): MoneyDto | null {
  if (!subtotal || !shipping || subtotal.currency !== Currency.ARS || shipping.currency !== Currency.ARS) return null
  return { amount: new Prisma.Decimal(subtotal.amount).add(shipping.amount).toFixed(2), currency: Currency.ARS }
}

export function isRosarioAddress(city: string, province: string): boolean {
  const normalize = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  return normalize(city) === 'rosario' && normalize(province) === 'santa fe'
}
