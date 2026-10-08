import { bucketIndex, defaultGroupBy, periodBuckets } from './analytics-buckets'

const days = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10),
  )

describe('analytics buckets', () => {
  it('picks days, weeks or months by the length of the period', () => {
    expect(defaultGroupBy(30)).toBe('day')
    expect(defaultGroupBy(90)).toBe('week')
    expect(defaultGroupBy(366)).toBe('month')
  })

  it('groups by Monday-to-Sunday weeks, cut at the ends of the period', () => {
    // 2026-10-01 is a Thursday.
    const buckets = periodBuckets(days('2026-10-01', 14), 'week')
    expect(buckets.map(bucket => [bucket.start, bucket.end])).toEqual([
      ['2026-10-01', '2026-10-04'],
      ['2026-10-05', '2026-10-11'],
      ['2026-10-12', '2026-10-14'],
    ])
    // Compared with the same offsets 14 days before.
    expect(buckets[0]).toMatchObject({ previousStart: '2026-09-17', previousEnd: '2026-09-20' })
  })

  it('groups by calendar month', () => {
    const buckets = periodBuckets(days('2026-08-15', 60), 'month')
    expect(buckets.map(bucket => [bucket.start, bucket.end])).toEqual([
      ['2026-08-15', '2026-08-31'],
      ['2026-09-01', '2026-09-30'],
      ['2026-10-01', '2026-10-13'],
    ])
  })

  it('maps every day of both periods to its bucket', () => {
    const index = bucketIndex(periodBuckets(days('2026-10-01', 14), 'week'))
    expect(index.current.get('2026-10-01')).toBe(0)
    expect(index.current.get('2026-10-14')).toBe(2)
    expect(index.previous.get('2026-09-17')).toBe(0)
    expect(index.previous.get('2026-09-30')).toBe(2)
    expect(index.current.size).toBe(14)
    expect(index.previous.size).toBe(14)
  })
})
