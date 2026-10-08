import { Prisma } from '../../generated/prisma/client'
import { OrderStatus } from '../../generated/prisma/enums'
import {
  bucketSeries,
  customerSplit,
  medianHoursToPay,
  orderOutcomes,
  type PaidOrderRow,
  salesBreakdown,
  salesMix,
  sumLines,
  topRows,
} from './analytics-rules'

const d = (value: string | number) => new Prisma.Decimal(value)
const order = (overrides: Partial<PaidOrderRow> & { buyer?: string } = {}): PaidOrderRow & { buyer: string } => ({
  placedAt: new Date('2026-10-01T12:00:00Z'),
  confirmedAt: new Date('2026-10-01T15:00:00Z'),
  subtotal: d(100),
  discountTotal: d(0),
  shippingTotal: d(0),
  total: d(100),
  contactEmail: 'ana@example.test',
  buyer: 'RETAIL',
  ...overrides,
})

describe('analytics rules', () => {
  it('adds values per bucket and ignores days outside the period', () => {
    const index = new Map([
      ['2026-10-01', 0],
      ['2026-10-02', 1],
    ])
    const items = [
      { day: '2026-10-01', amount: d('10.10') },
      { day: '2026-10-01', amount: d('0.20') },
      { day: '2026-09-01', amount: d(99) },
    ]
    const series = bucketSeries(
      items,
      item => item.day,
      item => item.amount,
      index,
      2,
    )
    expect(series.map(value => value.toFixed(2))).toEqual(['10.30', '0.00'])
  })

  it('splits sales into products, discounts and shipping', () => {
    const breakdown = salesBreakdown([
      order({ subtotal: d(100), discountTotal: d(12), shippingTotal: d(3500) }),
      order({ subtotal: d(50) }),
    ])
    expect(breakdown.products.toFixed(2)).toBe('150.00')
    expect(breakdown.discounts.toFixed(2)).toBe('12.00')
    expect(breakdown.shipping.toFixed(2)).toBe('3500.00')
  })

  it('takes the median hours to pay, null without orders', () => {
    const paidAfter = (hours: number) =>
      order({ confirmedAt: new Date(Date.parse('2026-10-01T12:00:00Z') + hours * 3_600_000) })
    expect(medianHoursToPay([])).toBeNull()
    expect(medianHoursToPay([paidAfter(1), paidAfter(30), paidAfter(2)])).toBe(2)
    expect(medianHoursToPay([paidAfter(1), paidAfter(2)])).toBe(1.5)
  })

  it('tells what became of the placed orders', () => {
    expect(
      orderOutcomes([
        OrderStatus.DELIVERED,
        OrderStatus.CONFIRMED,
        OrderStatus.PENDING_PAYMENT,
        OrderStatus.PAYMENT_UNDER_REVIEW,
        OrderStatus.EXPIRED,
        OrderStatus.CANCELLED,
      ]),
    ).toEqual({ placed: 6, paid: 2, waiting: 2, expired: 1, cancelled: 1 })
  })

  it('groups sales by a key, biggest first, keeping the previous sales of each key', () => {
    const rows = salesMix(
      [order({ buyer: 'RETAIL', total: d(10) }), order({ buyer: 'WHOLESALE', total: d(90) })],
      [order({ buyer: 'RETAIL', total: d(40) }), order({ buyer: 'OTHER', total: d(5) })],
      row => row.buyer,
    )
    expect(rows.map(row => [row.key, row.orders, row.sales.toNumber(), row.previousSales.toNumber()])).toEqual([
      ['WHOLESALE', 1, 90, 0],
      ['RETAIL', 1, 10, 40],
    ])
  })

  it('tells new from returning customers by email, ignoring case', () => {
    const split = customerSplit(
      [
        order({ contactEmail: 'Ana@Example.test', total: d(10) }),
        order({ contactEmail: 'ana@example.test', total: d(5) }),
        order({ contactEmail: 'beto@example.test', total: d(7) }),
      ],
      new Set(['ana@example.test']),
    )
    expect(split.customers).toBe(2)
    expect(split.returning).toBe(1)
    expect(split.returningSales.toNumber()).toBe(15)
    expect(split.newSales.toNumber()).toBe(7)
  })

  it('ranks by sales, then units, with the previous sales of each row', () => {
    const current = sumLines([
      { key: 1, name: 'L3250', units: 1, sales: d(300) },
      { key: 1, name: 'L3250', units: 2, sales: d(600) },
      { key: 2, name: 'T544', units: 9, sales: d(900) },
      { key: 3, name: 'Papel', units: 1, sales: d(10) },
    ])
    const previous = sumLines([{ key: 2, name: 'T544', units: 1, sales: d(100) }])
    const rows = topRows(current, previous, 2)
    expect(rows.map(row => [row.key, row.units, row.sales.toNumber(), row.previousSales.toNumber()])).toEqual([
      [2, 9, 900, 100],
      [1, 3, 900, 0],
    ])
  })
})
