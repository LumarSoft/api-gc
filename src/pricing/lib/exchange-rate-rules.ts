import { Prisma } from '../../generated/prisma/client'

/** Tolerance for clocks: a rate "for now" sent a few seconds late is still accepted. */
const PAST_TOLERANCE_MS = 5 * 60_000
const MAX_RATE = new Prisma.Decimal('99999999.9999')

/** Why a new exchange rate is not allowed, or null. */
export function exchangeRateError(rate: Prisma.Decimal, effectiveFrom: Date, now: Date): string | null {
  if (rate.lte(0) || rate.gt(MAX_RATE)) return 'The rate must be greater than zero'
  if (effectiveFrom.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    return 'A rate cannot start in the past: the history is never rewritten'
  }
  return null
}
