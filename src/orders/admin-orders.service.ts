import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { ListOrdersDto } from './dto/order-input.dto'
import type { OrderResponseDto, OrdersPageDto } from './dto/order-response.dto'
import { orderSelect } from './lib/order-selects'
import { OrderMapper } from './order.mapper'

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: OrderMapper,
  ) {}

  async list(query: ListOrdersDto): Promise<OrdersPageDto> {
    const where: Prisma.OrderWhereInput = { ...(query.status ? { status: query.status } : {}) }
    const [rows, total, job, overdue] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: orderSelect,
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
      items: rows.map(row => this.mapper.response(row, true)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
      expiryJobFailed:
        overdue > 0 || Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.failed),
    }
  }

  async read(id: number): Promise<OrderResponseDto> {
    const row = await this.prisma.order.findUnique({ where: { id }, select: orderSelect })
    if (!row) throw new NotFoundException('Pedido no encontrado.')
    return this.mapper.response(row, true)
  }
}
