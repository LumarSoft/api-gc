import { Prisma } from '../../generated/prisma/client'
import { Currency, DeliveryMethod } from '../../generated/prisma/enums'
import type { MoneyDto } from '../../pricing/pricing.service'
import type { PreviewCheckoutDto } from '../dto/checkout-input.dto'
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

/** Whether the cart can go by carrier, and the price of the quote the buyer chose, if any. */
export interface CarrierDelivery {
  enabled: boolean
  reason: string | null
  cost: MoneyDto | null
}

export function checkoutDeliveryOptions(
  config: ShippingConfiguration[],
  subtotal: MoneyDto | null,
  carrier: CarrierDelivery,
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
      enabled: carrier.enabled,
      cost: carrier.enabled ? carrier.cost : null,
      unavailableReason: carrier.enabled ? null : carrier.reason,
    },
  ]
}

/** What the delivery method needs from the buyer beyond the DTO rules; null when the input is complete. */
export function deliveryInputError(input: PreviewCheckoutDto): string | null {
  const address = input.shippingAddress
  if (
    input.deliveryMethod === DeliveryMethod.LOCAL_DELIVERY &&
    (!address || !isRosarioAddress(address.city, address.province))
  )
    return 'La entrega local requiere una dirección en Rosario, Santa Fe.'
  if (input.deliveryMethod === DeliveryMethod.CARRIER) {
    if (!address) return 'Completá la dirección de envío.'
    if (!address.taxId) return 'Completá el DNI o CUIT de quien recibe el envío.'
    if (!input.phone) return 'Completá un teléfono de contacto para el envío.'
    if (!input.shippingQuoteId) return 'Elegí una opción de envío.'
  }
  return null
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
