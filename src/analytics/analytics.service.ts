import { BadRequestException, Injectable } from '@nestjs/common'
import { argentineDay, periodProblem, reportPeriod, type ReportPeriod } from '../common/utils/report-period'
import type { Prisma } from '../generated/prisma/client'
import { Currency, OrderStatus, UserRole, WholesaleStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AnalyticsMapper, type SoldVariantLine } from './analytics.mapper'
import type { AnalyticsQueryDto } from './dto/analytics-query.dto'
import type { AdminAnalyticsDto } from './dto/analytics-response.dto'
import { bucketIndex, defaultGroupBy, periodBuckets } from './lib/analytics-buckets'
import {
  bucketSeries,
  customerKey,
  customerSplit,
  medianHoursToPay,
  orderOutcomes,
  PAID_STATUSES,
  salesBreakdown,
  salesMix,
  sumOf,
} from './lib/analytics-rules'
import { paidOrderSelect, soldVariantSelect } from './lib/analytics-selects'

type Window = { gte: Date; lt: Date }
const current = (period: ReportPeriod): Window => ({ gte: period.from, lt: period.until })
const previous = (period: ReportPeriod): Window => ({ gte: period.previousFrom, lt: period.from })
const both = (period: ReportPeriod): Window => ({ gte: period.previousFrom, lt: period.until })
const paidIn = (window: Window): Prisma.OrderWhereInput => ({
  status: { in: PAID_STATUSES },
  currency: Currency.ARS,
  confirmedAt: window,
})

/** Store stats for the admin: sales, orders, products and customers of a period against the previous one. */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: AnalyticsMapper,
  ) {}

  async report(query: AnalyticsQueryDto = {}, now = new Date()): Promise<AdminAnalyticsDto> {
    const problem = periodProblem(now, query.from, query.to)
    if (problem) throw new BadRequestException(problem)
    const period = reportPeriod(now, query.from, query.to)
    const groupBy = query.groupBy ?? defaultGroupBy(period.days.length)
    const buckets = periodBuckets(period.days, groupBy)
    const index = bucketIndex(buckets)

    const [paid, placed, lines, customers] = await Promise.all([
      this.paidOrders(period),
      this.placedOrders(period),
      this.soldLines(period),
      this.customerActivity(period),
    ])
    const [boughtBefore, boughtBeforePrevious] = await Promise.all([
      this.customersWhoPaidBefore(paid.current, period.from),
      this.customersWhoPaidBefore(paid.previous, period.previousFrom),
    ])

    type Paid = (typeof paid.current)[number]
    const paidDay = (order: Paid) => argentineDay(order.confirmedAt)
    const salesSeries = (orders: Paid[], days: Map<string, number>) =>
      bucketSeries(orders, paidDay, order => order.total, days, buckets.length)
    const countSeries = (orders: Paid[], days: Map<string, number>) =>
      bucketSeries(orders, paidDay, () => 1, days, buckets.length).map(value => value.toNumber())
    const sales = { current: sumOf(paid.current, o => o.total), previous: sumOf(paid.previous, o => o.total) }
    const split = {
      current: customerSplit(paid.current, boughtBefore),
      previous: customerSplit(paid.previous, boughtBeforePrevious),
    }
    const m = this.mapper

    return {
      period: {
        from: period.days[0],
        to: period.days.at(-1)!,
        previousFrom: buckets[0].previousStart,
        previousTo: buckets.at(-1)!.previousEnd,
        groupBy,
      },
      buckets,
      sales: {
        ...m.comparedMoney(sales),
        series: {
          current: salesSeries(paid.current, index.current).map(m.decimal),
          previous: salesSeries(paid.previous, index.previous).map(m.decimal),
        },
      },
      breakdown: m.breakdown(salesBreakdown(paid.current), salesBreakdown(paid.previous)),
      orders: {
        current: paid.current.length,
        previous: paid.previous.length,
        series: {
          current: countSeries(paid.current, index.current),
          previous: countSeries(paid.previous, index.previous),
        },
      },
      averageOrder: {
        current: m.average(sales.current, paid.current.length),
        previous: m.average(sales.previous, paid.previous.length),
      },
      outcomes: { current: orderOutcomes(placed.current), previous: orderOutcomes(placed.previous) },
      hoursToPay: { current: medianHoursToPay(paid.current), previous: medianHoursToPay(paid.previous) },
      buyerTypes: m.mix(salesMix(paid.current, paid.previous, order => order.buyerType)),
      paymentMethods: m.mix(salesMix(paid.current, paid.previous, order => order.paymentMethod)),
      deliveryMethods: m.mix(salesMix(paid.current, paid.previous, order => order.deliveryMethod)),
      ...m.rankings(lines.current, lines.previous),
      customers: {
        total: { current: split.current.customers, previous: split.previous.customers },
        returning: { current: split.current.returning, previous: split.previous.returning },
        newSales: m.money(split.current.newSales),
        returningSales: m.money(split.current.returningSales),
        ...customers,
      },
    }
  }

  /** Paid ARS orders of both periods, by payment confirmation date. */
  private async paidOrders(period: ReportPeriod) {
    const rows = await this.prisma.order.findMany({ where: paidIn(both(period)), select: paidOrderSelect })
    const paid = rows.flatMap(row => (row.confirmedAt ? [{ ...row, confirmedAt: row.confirmedAt }] : []))
    return {
      current: paid.filter(order => order.confirmedAt >= period.from),
      previous: paid.filter(order => order.confirmedAt < period.from),
    }
  }

  /** Current status of the orders placed in each period. */
  private async placedOrders(period: ReportPeriod): Promise<{ current: OrderStatus[]; previous: OrderStatus[] }> {
    const rows = await this.prisma.order.findMany({
      where: { placedAt: both(period) },
      select: { placedAt: true, status: true },
    })
    return {
      current: rows.filter(row => row.placedAt >= period.from).map(row => row.status),
      previous: rows.filter(row => row.placedAt < period.from).map(row => row.status),
    }
  }

  /** Units and line totals per sold variant in each period, with the variant's product. */
  private async soldLines(period: ReportPeriod): Promise<{ current: SoldVariantLine[]; previous: SoldVariantLine[] }> {
    const totals = (window: Window) =>
      this.prisma.orderItem.groupBy({
        by: ['variantId'],
        where: { order: paidIn(window) },
        _sum: { quantity: true, lineTotal: true },
      })
    const [currentTotals, previousTotals] = await Promise.all([totals(current(period)), totals(previous(period))])
    const ids = [...new Set([...currentTotals, ...previousTotals].map(row => row.variantId))]
    const variants = new Map(
      (await this.prisma.productVariant.findMany({ where: { id: { in: ids } }, select: soldVariantSelect })).map(
        variant => [variant.id, variant],
      ),
    )
    const lines = (rows: typeof currentTotals): SoldVariantLine[] =>
      rows.map(row => ({
        variant: variants.get(row.variantId)!,
        units: row._sum.quantity ?? 0,
        sales: row._sum.lineTotal!,
      }))
    return { current: lines(currentTotals), previous: lines(previousTotals) }
  }

  /** Which of these orders' customers had already paid an order before `before` (any currency, any time). */
  private async customersWhoPaidBefore(orders: { contactEmail: string }[], before: Date): Promise<Set<string>> {
    const emails = [...new Set(orders.map(order => customerKey(order.contactEmail)))]
    if (emails.length === 0) return new Set()
    const rows = await this.prisma.order.findMany({
      where: { status: { in: PAID_STATUSES }, confirmedAt: { lt: before }, contactEmail: { in: emails } },
      select: { contactEmail: true },
      distinct: ['contactEmail'],
    })
    return new Set(rows.map(row => customerKey(row.contactEmail)))
  }

  /** New accounts and frequent-customer applications. */
  private async customerActivity(period: ReportPeriod) {
    const signUps = (window: Window) =>
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER, deletedAt: null, createdAt: window } })
    const received = (window: Window) =>
      this.prisma.wholesaleApplication.count({ where: { deletedAt: null, createdAt: window } })
    const approved = (window: Window) =>
      this.prisma.wholesaleApplication.count({
        where: { deletedAt: null, status: WholesaleStatus.APPROVED, reviewedAt: window },
      })
    const [signUpsNow, signUpsBefore, receivedNow, receivedBefore, approvedNow, approvedBefore, pending] =
      await Promise.all([
        signUps(current(period)),
        signUps(previous(period)),
        received(current(period)),
        received(previous(period)),
        approved(current(period)),
        approved(previous(period)),
        this.prisma.wholesaleApplication.count({ where: { deletedAt: null, status: WholesaleStatus.PENDING } }),
      ])
    return {
      signUps: { current: signUpsNow, previous: signUpsBefore },
      frequentCustomerApplications: {
        received: { current: receivedNow, previous: receivedBefore },
        approved: { current: approvedNow, previous: approvedBefore },
        pending,
      },
    }
  }
}
