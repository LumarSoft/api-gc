import { Injectable } from '@nestjs/common'
import { argentineDay } from '../common/utils/report-period'
import { Prisma } from '../generated/prisma/client'
import { ActivityType, CartStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AnalyticsMapper } from './analytics.mapper'
import type { AnalyticsQueryDto } from './dto/analytics-query.dto'
import type { AdminBehaviorDto, SearchRowDto } from './dto/behavior-response.dto'
import { analyticsPeriod, type AnalyticsPeriod, type Window } from './lib/analytics-period'
import { paidIn, productSummarySelect } from './lib/analytics-selects'
import {
  ABANDON_AFTER_HOURS,
  abandonedBefore,
  cartsPerProduct,
  type Funnel,
  funnelFrom,
  visitorSeries,
} from './lib/behavior-rules'

const TOP_PRODUCTS = 10
const TOP_SEARCHES = 10
const TOP_ABANDONED = 5

/** `COUNT()` comes back as a BigInt from the driver. */
const count = (value: bigint | number): number => Number(value)
const inPeriod = (value: bigint | number): boolean => Number(value) === 1

/**
 * What anonymous visitors did (ActivityEvent) plus abandoned carts. Distinct-visitor counts need SQL `COUNT(DISTINCT)`,
 * which Prisma's query API lacks, so those queries are raw (parameterized) SQL.
 */
@Injectable()
export class BehaviorAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: AnalyticsMapper,
  ) {}

  async report(query: AnalyticsQueryDto = {}, now = new Date()): Promise<AdminBehaviorDto> {
    const range = analyticsPeriod(query, now)
    const [funnel, visits, products, searches, carts, first] = await Promise.all([
      this.funnel(range),
      this.visits(range.both),
      this.topProducts(range.current),
      this.searches(range),
      this.carts(range, now),
      this.prisma.activityEvent.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ])
    const length = range.buckets.length
    return {
      period: range.summary,
      buckets: range.buckets,
      trackingSince: first ? argentineDay(first.createdAt) : null,
      visitors: {
        current: funnel.current.visited,
        previous: funnel.previous.visited,
        series: {
          current: visitorSeries(visits, range.index.current, length),
          previous: visitorSeries(visits, range.index.previous, length),
        },
      },
      funnel,
      products,
      searches,
      carts,
    }
  }

  /** Distinct visitors overall and per step, in both periods. */
  private async funnel(range: AnalyticsPeriod): Promise<{ current: Funnel; previous: Funnel }> {
    const { both, period } = range
    const [overall, byType] = await Promise.all([
      this.prisma.$queryRaw<{ inPeriod: bigint; visitors: bigint }[]>`
        SELECT createdAt >= ${period.from} AS inPeriod, COUNT(DISTINCT visitorId) AS visitors
        FROM ActivityEvent WHERE createdAt >= ${both.gte} AND createdAt < ${both.lt}
        GROUP BY inPeriod`,
      this.prisma.$queryRaw<{ inPeriod: bigint; type: ActivityType; visitors: bigint }[]>`
        SELECT createdAt >= ${period.from} AS inPeriod, type, COUNT(DISTINCT visitorId) AS visitors
        FROM ActivityEvent WHERE createdAt >= ${both.gte} AND createdAt < ${both.lt}
        GROUP BY inPeriod, type`,
    ])
    const of = (current: boolean): Funnel =>
      funnelFrom(
        count(overall.find(row => inPeriod(row.inPeriod) === current)?.visitors ?? 0),
        byType
          .filter(row => inPeriod(row.inPeriod) === current)
          .map(row => ({ type: row.type, visitors: count(row.visitors) })),
      )
    return { current: of(true), previous: of(false) }
  }

  /** Each visitor once per Argentine day they did something. */
  private visits(window: Window): Promise<{ visitorId: string; day: string }[]> {
    return this.prisma.$queryRaw<{ visitorId: string; day: string }[]>`
      SELECT DISTINCT visitorId, DATE_FORMAT(createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') AS day
      FROM ActivityEvent WHERE createdAt >= ${window.gte} AND createdAt < ${window.lt}`
  }

  /** Most viewed products, with visitors who added them to a cart and units sold in the period. */
  private async topProducts(window: Window): Promise<AdminBehaviorDto['products']> {
    const viewed = await this.prisma.$queryRaw<{ productId: number; visitors: bigint }[]>`
      SELECT productId, COUNT(DISTINCT visitorId) AS visitors FROM ActivityEvent
      WHERE type = ${ActivityType.PRODUCT_VIEW} AND createdAt >= ${window.gte} AND createdAt < ${window.lt}
      GROUP BY productId ORDER BY visitors DESC, productId LIMIT ${TOP_PRODUCTS}`
    if (viewed.length === 0) return []
    const ids = viewed.map(row => row.productId)
    const [added, sold, products] = await Promise.all([
      this.prisma.$queryRaw<{ productId: number; visitors: bigint }[]>`
        SELECT productId, COUNT(DISTINCT visitorId) AS visitors FROM ActivityEvent
        WHERE type = ${ActivityType.ADD_TO_CART} AND createdAt >= ${window.gte} AND createdAt < ${window.lt}
          AND productId IN (${Prisma.join(ids)})
        GROUP BY productId`,
      this.prisma.orderItem.findMany({
        where: { order: paidIn(window), variant: { productId: { in: ids } } },
        select: { quantity: true, variant: { select: { productId: true } } },
      }),
      this.prisma.product.findMany({ where: { id: { in: ids } }, select: productSummarySelect }),
    ])
    const byId = new Map(products.map(product => [product.id, product]))
    return viewed.map(row => ({
      ...this.mapper.productSummary(byId.get(row.productId)!),
      viewers: count(row.visitors),
      addedToCart: count(added.find(item => item.productId === row.productId)?.visitors ?? 0),
      unitsSold: sold
        .filter(item => item.variant.productId === row.productId)
        .reduce((sum, item) => sum + item.quantity, 0),
    }))
  }

  /** Search totals in both periods, the most searched texts and the ones that never found anything. */
  private async searches(range: AnalyticsPeriod): Promise<AdminBehaviorDto['searches']> {
    const { both, current, period } = range
    const ranking = (onlyUnanswered: boolean) => this.prisma.$queryRaw<
      { query: string; searches: bigint; visitors: bigint; results: number }[]
    >`
      SELECT searchQuery AS query, COUNT(*) AS searches, COUNT(DISTINCT visitorId) AS visitors,
        MAX(resultCount) AS results
      FROM ActivityEvent
      WHERE type = ${ActivityType.SEARCH} AND createdAt >= ${current.gte} AND createdAt < ${current.lt}
      GROUP BY searchQuery
      ${onlyUnanswered ? Prisma.sql`HAVING MAX(resultCount) = 0` : Prisma.empty}
      ORDER BY visitors DESC, searches DESC, query LIMIT ${TOP_SEARCHES}`
    const [totals, top, unanswered] = await Promise.all([
      this.prisma.$queryRaw<{ inPeriod: bigint; searches: bigint; unanswered: bigint | null }[]>`
        SELECT createdAt >= ${period.from} AS inPeriod, COUNT(*) AS searches, SUM(resultCount = 0) AS unanswered
        FROM ActivityEvent
        WHERE type = ${ActivityType.SEARCH} AND createdAt >= ${both.gte} AND createdAt < ${both.lt}
        GROUP BY inPeriod`,
      ranking(false),
      ranking(true),
    ])
    const total = (current: boolean, key: 'searches' | 'unanswered') =>
      count(totals.find(row => inPeriod(row.inPeriod) === current)?.[key] ?? 0)
    const row = (item: (typeof top)[number]): SearchRowDto => ({
      query: item.query,
      searches: count(item.searches),
      visitors: count(item.visitors),
      results: Number(item.results ?? 0),
    })
    return {
      total: { current: total(true, 'searches'), previous: total(false, 'searches') },
      withoutResults: { current: total(true, 'unanswered'), previous: total(false, 'unanswered') },
      top: top.map(row),
      unanswered: unanswered.map(row),
    }
  }

  /** Abandoned carts against orders placed, and the products left behind most. */
  private async carts(range: AnalyticsPeriod, now: Date): Promise<AdminBehaviorDto['carts']> {
    const abandonedIn = (window: Window): Prisma.CartWhereInput => ({
      status: CartStatus.ACTIVE,
      deletedAt: null,
      lastActivityAt: { gte: window.gte, lt: abandonedBefore(window.lt, now) },
      items: { some: { deletedAt: null } },
    })
    const [abandonedNow, abandonedPrevious, placedNow, placedBefore, lines] = await Promise.all([
      this.prisma.cart.count({ where: abandonedIn(range.current) }),
      this.prisma.cart.count({ where: abandonedIn(range.previous) }),
      this.prisma.order.count({ where: { placedAt: range.current } }),
      this.prisma.order.count({ where: { placedAt: range.previous } }),
      this.prisma.cartItem.findMany({
        where: { deletedAt: null, cart: abandonedIn(range.current) },
        select: { cartId: true, quantity: true, variant: { select: { productId: true } } },
      }),
    ])
    const top = cartsPerProduct(
      lines.map(line => ({ cartId: line.cartId, quantity: line.quantity, productId: line.variant.productId })),
    ).slice(0, TOP_ABANDONED)
    const products = await this.prisma.product.findMany({
      where: { id: { in: top.map(row => row.productId) } },
      select: productSummarySelect,
    })
    const byId = new Map(products.map(product => [product.id, product]))
    return {
      abandoned: { current: abandonedNow, previous: abandonedPrevious },
      ordersPlaced: { current: placedNow, previous: placedBefore },
      abandonAfterHours: ABANDON_AFTER_HOURS,
      products: top.map(row => ({
        ...this.mapper.productSummary(byId.get(row.productId)!),
        carts: row.carts,
        units: row.units,
      })),
    }
  }
}
