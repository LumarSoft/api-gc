import { Prisma } from '../../generated/prisma/client'
import {
  argentineDay,
  averageOrder,
  dailySeries,
  dashboardRange,
  isCalendarDay,
  periodTotals,
  rangeProblem,
} from './dashboard-rules'

describe('dashboard rules', () => {
  it('uses Argentine days: 01:00 UTC still belongs to the previous day', () => {
    expect(argentineDay(new Date('2026-10-08T01:00:00Z'))).toBe('2026-10-07')
    expect(argentineDay(new Date('2026-10-08T03:00:00Z'))).toBe('2026-10-08')
  })

  it('defaults to the last 30 Argentine days including today, and the same length before', () => {
    const range = dashboardRange(new Date('2026-10-08T15:00:00Z'))
    expect(range.days).toHaveLength(30)
    expect(range.days.at(-1)).toBe('2026-10-08')
    expect(range.from.toISOString()).toBe('2026-09-09T03:00:00.000Z')
    expect(range.until.toISOString()).toBe('2026-10-09T03:00:00.000Z')
    expect(range.previousFrom.toISOString()).toBe('2026-08-10T03:00:00.000Z')
  })

  it('takes an explicit range with both ends included', () => {
    const range = dashboardRange(new Date('2026-10-08T15:00:00Z'), '2026-10-06', '2026-10-07')
    expect(range.days).toEqual(['2026-10-06', '2026-10-07'])
    expect(range.until.toISOString()).toBe('2026-10-08T03:00:00.000Z')
    expect(range.previousFrom.toISOString()).toBe('2026-10-04T03:00:00.000Z')
  })

  it('rejects incomplete, reversed, future or too long ranges', () => {
    const now = new Date('2026-10-08T15:00:00Z')
    expect(rangeProblem(now)).toBeNull()
    expect(rangeProblem(now, '2026-10-01', '2026-10-08')).toBeNull()
    expect(rangeProblem(now, '2026-10-01')).toMatch(/inicio y el fin/)
    expect(rangeProblem(now, '2026-10-08', '2026-10-01')).toMatch(/anterior/)
    expect(rangeProblem(now, '2026-10-01', '2026-10-09')).toMatch(/futuro/)
    expect(rangeProblem(now, '2025-01-01', '2026-10-08')).toMatch(/366/)
    expect(isCalendarDay('2026-02-30')).toBe(false)
    expect(isCalendarDay('2026-02-28')).toBe(true)
  })

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
