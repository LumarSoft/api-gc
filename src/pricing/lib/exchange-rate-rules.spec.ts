import { Prisma } from '../../generated/prisma/client'
import { exchangeRateError } from './exchange-rate-rules'

describe('exchangeRateError', () => {
  const now = new Date('2026-10-05T12:00:00Z')
  const rate = (value: string) => new Prisma.Decimal(value)

  it('accepts a positive rate from now on or scheduled', () => {
    expect(exchangeRateError(rate('1450.50'), now, now)).toBeNull()
    expect(exchangeRateError(rate('1450'), new Date('2026-10-06T09:00:00Z'), now)).toBeNull()
    expect(exchangeRateError(rate('1450'), new Date('2026-10-05T11:58:00Z'), now)).toBeNull()
  })

  it('rejects zero and backdated rates', () => {
    expect(exchangeRateError(rate('0'), now, now)).toMatch(/greater than zero/)
    expect(exchangeRateError(rate('1450'), new Date('2026-10-04T12:00:00Z'), now)).toMatch(/past/)
  })
})
