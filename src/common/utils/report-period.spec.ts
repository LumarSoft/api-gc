import { addDays, argentineDay, isCalendarDay, periodProblem, reportPeriod } from './report-period'

describe('report period', () => {
  it('uses Argentine days: 01:00 UTC still belongs to the previous day', () => {
    expect(argentineDay(new Date('2026-10-08T01:00:00Z'))).toBe('2026-10-07')
    expect(argentineDay(new Date('2026-10-08T03:00:00Z'))).toBe('2026-10-08')
  })

  it('defaults to the last 30 Argentine days including today, and the same length before', () => {
    const range = reportPeriod(new Date('2026-10-08T15:00:00Z'))
    expect(range.days).toHaveLength(30)
    expect(range.days.at(-1)).toBe('2026-10-08')
    expect(range.from.toISOString()).toBe('2026-09-09T03:00:00.000Z')
    expect(range.until.toISOString()).toBe('2026-10-09T03:00:00.000Z')
    expect(range.previousFrom.toISOString()).toBe('2026-08-10T03:00:00.000Z')
  })

  it('takes an explicit range with both ends included', () => {
    const range = reportPeriod(new Date('2026-10-08T15:00:00Z'), '2026-10-06', '2026-10-07')
    expect(range.days).toEqual(['2026-10-06', '2026-10-07'])
    expect(range.until.toISOString()).toBe('2026-10-08T03:00:00.000Z')
    expect(range.previousFrom.toISOString()).toBe('2026-10-04T03:00:00.000Z')
  })

  it('rejects incomplete, reversed, future or too long ranges', () => {
    const now = new Date('2026-10-08T15:00:00Z')
    expect(periodProblem(now)).toBeNull()
    expect(periodProblem(now, '2026-10-01', '2026-10-08')).toBeNull()
    expect(periodProblem(now, '2026-10-01')).toMatch(/inicio y el fin/)
    expect(periodProblem(now, '2026-10-08', '2026-10-01')).toMatch(/anterior/)
    expect(periodProblem(now, '2026-10-01', '2026-10-09')).toMatch(/futuro/)
    expect(periodProblem(now, '2025-01-01', '2026-10-08')).toMatch(/366/)
    expect(isCalendarDay('2026-02-30')).toBe(false)
    expect(isCalendarDay('2026-02-28')).toBe(true)
  })

  it('moves calendar days across month ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
