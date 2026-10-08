import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { OrderStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ListOrdersDto } from './dto/order-input.dto'
import type { OrderCountsDto, OrderResponseDto, OrdersPageDto } from './dto/order-response.dto'
import { ORDER_STAGES, stageCounts } from './lib/order-rules'
import { adminOrderSelect } from './lib/order-selects'
import { OrderMapper } from './order.mapper'

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: OrderMapper,
  ) {}

  async list(query: ListOrdersDto): Promise<OrdersPageDto> {
    const where = this.listWhere(query)
    const [rows, total, job, overdue] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: adminOrderSelect,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
      this.prisma.setting.findUnique({ where: { key: 'orders.expiryJob' }, select: { value: true } }),
      this.prisma.order.count({
        where: { status: 'PENDING_PAYMENT', expiresAt: { lt: new Date(Date.now() - 120_000) } },
      }),
    ])
    const value = job?.value
    return {
      items: rows.map(row => this.mapper.adminResponse(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      expiryJobFailed:
        overdue > 0 || Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.failed),
    }
  }

  /** How many orders wait in each open stage (nav badge and list views). */
  async counts(): Promise<OrderCountsDto> {
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: { status: { notIn: ORDER_STAGES.CLOSED } },
      _count: { _all: true },
    })
    return stageCounts(Object.fromEntries(groups.map(group => [group.status, group._count._all])))
  }

  async read(id: number): Promise<OrderResponseDto> {
    const row = await this.prisma.order.findUnique({ where: { id }, select: adminOrderSelect })
    if (!row) throw new NotFoundException('Pedido no encontrado.')
    return this.mapper.adminResponse(row)
  }

  private listWhere(query: ListOrdersDto): Prisma.OrderWhereInput {
    const statuses: OrderStatus[][] = []
    if (query.status) statuses.push([query.status])
    if (query.stage) statuses.push(ORDER_STAGES[query.stage])
    const q = query.q
    return {
      AND: [
        ...statuses.map(group => ({ status: { in: group } })),
        ...(q
          ? [
              {
                OR: [
                  { number: { contains: q } },
                  { contactEmail: { contains: q } },
                  { addresses: { some: { name: { contains: q } } } },
                ],
              },
            ]
          : []),
      ],
    }
  }
}
