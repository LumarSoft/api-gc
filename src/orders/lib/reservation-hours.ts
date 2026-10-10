import { PaymentMethod } from '../../generated/prisma/enums'

/** Provisional manual-payment window; configurable in Setting, matching the existing transfer window. */
export function reservationHours(setting: { value: unknown; deletedAt: Date | null } | null): number {
  const value = setting && !setting.deletedAt ? setting.value : null
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 168 ? value : 24
}

/**
 * Mercado Pago orders are paid online right away (approved or rejected at once), so their stock is held for an hour
 * instead of the manual window. Provisional; revisit with the client.
 */
export const MERCADO_PAGO_RESERVATION_MINUTES = 60

/**
 * The checkout stops taking payments this long before the reservation ends, so an approval reaches us (webhook or
 * the buyer's return) while the stock is still reserved.
 */
export const MERCADO_PAGO_CLOSING_MINUTES = 10

/** How long checkout holds the stock of a new order, by how it is paid. */
export function reservationMinutes(
  method: PaymentMethod,
  setting: { value: unknown; deletedAt: Date | null } | null,
): number {
  return method === PaymentMethod.MERCADO_PAGO ? MERCADO_PAGO_RESERVATION_MINUTES : reservationHours(setting) * 60
}
