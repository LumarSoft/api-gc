import { ActivityType } from '../../generated/prisma/enums'
import { abandonedBefore, cartsPerProduct, funnelFrom, visitorSeries } from './behavior-rules'

describe('behavior rules', () => {
  it('builds the funnel from distinct visitors per step', () => {
    expect(
      funnelFrom(10, [
        { type: ActivityType.VISIT, visitors: 9 },
        { type: ActivityType.PRODUCT_VIEW, visitors: 6 },
        { type: ActivityType.SEARCH, visitors: 4 },
        { type: ActivityType.ADD_TO_CART, visitors: 3 },
        { type: ActivityType.ORDER_PLACED, visitors: 1 },
      ]),
    ).toEqual({ visited: 10, viewedProduct: 6, addedToCart: 3, startedCheckout: 0, placedOrder: 1 })
  })

  it('counts each visitor once per chart point', () => {
    const index = new Map([
      ['2026-10-06', 0],
      ['2026-10-07', 0],
      ['2026-10-08', 1],
    ])
    const series = visitorSeries(
      [
        { visitorId: 'a', day: '2026-10-06' },
        { visitorId: 'a', day: '2026-10-07' },
        { visitorId: 'b', day: '2026-10-07' },
        { visitorId: 'a', day: '2026-10-08' },
        { visitorId: 'c', day: '2026-09-01' },
      ],
      index,
      2,
    )
    expect(series).toEqual([2, 1])
  })

  it('only counts carts untouched for 24 hours as abandoned', () => {
    const now = new Date('2026-10-08T15:00:00Z')
    expect(abandonedBefore(new Date('2026-10-09T03:00:00Z'), now).toISOString()).toBe('2026-10-07T15:00:00.000Z')
    expect(abandonedBefore(new Date('2026-09-01T03:00:00Z'), now).toISOString()).toBe('2026-09-01T03:00:00.000Z')
  })

  it('counts carts and units per product, most carts first', () => {
    expect(
      cartsPerProduct([
        { cartId: 1, productId: 7, quantity: 2 },
        { cartId: 1, productId: 7, quantity: 1 },
        { cartId: 2, productId: 9, quantity: 1 },
        { cartId: 3, productId: 9, quantity: 4 },
      ]),
    ).toEqual([
      { productId: 9, carts: 2, units: 5 },
      { productId: 7, carts: 1, units: 3 },
    ])
  })
})
