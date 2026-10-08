import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { Currency, OrderStatus, ProductStatus, WholesaleStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { outOfStockWhere } from '../products/lib/admin-product-filters'
import type { DashboardQueryDto } from './dto/dashboard-query.dto'
import type { AdminDashboardDto } from './dto/dashboard-response.dto'
import {
  argentineDay,
  averageOrder,
  dailySeries,
  dashboardRange,
  rangeProblem,
  type PaidOrder,
  periodTotals,
} from './lib/dashboard-rules'

/** Orders whose payment staff verified (the store's sales). */
const PAID: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
]

/** The admin home: how the store did in a period (last 30 days by default) and what is waiting outside orders. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: DashboardQueryDto = {}, now = new Date()): Promise<AdminDashboardDto> {
    const problem = rangeProblem(now, query.from, query.to)
    if (problem) throw new BadRequestException(problem)
    const range = dashboardRange(now, query.from, query.to)
    const [paid, placed, previousPlaced, wholesalePending, publishedOutOfStock, drafts] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          status: { in: PAID },
          currency: Currency.ARS,
          confirmedAt: { gte: range.previousFrom, lt: range.until },
        },
        select: { confirmedAt: true, total: true },
      }),
      this.prisma.order.findMany({
        where: { placedAt: { gte: range.from, lt: range.until } },
        select: { placedAt: true },
      }),
      this.prisma.order.count({ where: { placedAt: { gte: range.previousFrom, lt: range.from } } }),
      this.prisma.wholesaleApplication.count({ where: { status: WholesaleStatus.PENDING, deletedAt: null } }),
      this.prisma.product.count({
        where: {
          AND: [
            { deletedAt: null, status: ProductStatus.PUBLISHED },
            outOfStockWhere(this.prisma.inventoryLevel.fields.reserved),
          ],
        },
      }),
      this.prisma.product.count({ where: { deletedAt: null, status: ProductStatus.DRAFT } }),
    ])

    const paidOrders = paid.filter((order): order is PaidOrder => order.confirmedAt !== null)
    const current = periodTotals(paidOrders.filter(order => order.confirmedAt >= range.from))
    const previous = periodTotals(paidOrders.filter(order => order.confirmedAt < range.from))
    const money = (value: Prisma.Decimal | null) =>
      value ? { amount: value.toFixed(2), currency: Currency.ARS } : null

    return {
      days: range.days,
      sales: {
        current: money(current.sales)!,
        previous: money(previous.sales)!,
        daily: dailySeries(
          range.days,
          paidOrders,
          order => argentineDay(order.confirmedAt),
          (sum, order) => sum.plus(order.total),
        ).map(value => value.toFixed(2)),
      },
      orders: {
        current: placed.length,
        previous: previousPlaced,
        daily: dailySeries(
          range.days,
          placed,
          order => argentineDay(order.placedAt),
          sum => sum.plus(1),
        ).map(value => value.toNumber()),
      },
      averageOrder: { current: money(averageOrder(current)), previous: money(averageOrder(previous)) },
      todo: { wholesalePending, publishedOutOfStock, drafts },
    }
  }
}
