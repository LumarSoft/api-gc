import { Prisma } from '../../generated/prisma/client'
import { averageOrder, dailySeries, periodTotals } from './dashboard-rules'

describe('dashboard rules', () => {
  it('sums with decimals and averages only when there are paid orders', () => {
    const totals = periodTotals([
      { confirmedAt: new Date(), total: new Prisma.Decimal('10.10') },
      { confirmedAt: new Date(), total: new Prisma.Decimal('0.20') },
    ])
    expect(totals.sales.toFixed(2)).toBe('10.30')
    expect(averageOrder(totals)?.toFixed(2)).toBe('5.15')
    expect(averageOrder(periodTotals([]))).toBeNull()
  })

  it('fills days without activity with zero and ignores days outside the range', () => {
    const series = dailySeries(
      ['2026-10-07', '2026-10-08'],
      [
        { day: '2026-10-08', amount: 5 },
        { day: '2026-10-08', amount: 2 },
        { day: '2026-09-01', amount: 9 },
      ],
      item => item.day,
      (sum, item) => sum.plus(item.amount),
    )
    expect(series.map(value => value.toNumber())).toEqual([0, 7])
  })
})
