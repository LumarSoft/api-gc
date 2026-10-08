import { Prisma } from '../../generated/prisma/client'

/** Setting key of the manual-payment reservation window (read by checkout and orders, see reservation-hours.ts). */
export const RESERVATION_HOURS_KEY = 'reservation.manualHours'
export const RESERVATION_HOURS_DEFAULT = 24
export const RESERVATION_HOURS_MAX = 168

/** Default name and description of Rosario delivery when staff turn it on for the first time (shown at checkout). */
export const LOCAL_DELIVERY_DEFAULTS = {
  name: 'Entrega en Rosario',
  description: 'Entrega a domicilio dentro de Rosario.',
} as const

/**
 * Why a Rosario delivery setup cannot be saved, or null. Turning it on needs a rate; a free-shipping amount, when set,
 * must be above zero (zero would make every order free: leave the rate at 0 for that).
 */
export function localDeliveryProblem(input: {
  isActive: boolean
  flatRate: Prisma.Decimal | null
  freeShippingThreshold: Prisma.Decimal | null
}): string | null {
  if (input.isActive && !input.flatRate) return 'Para activar la entrega en Rosario cargá la tarifa.'
  if (input.freeShippingThreshold && input.freeShippingThreshold.lte(0))
    return 'El monto para envío gratis tiene que ser mayor a cero.'
  return null
}
