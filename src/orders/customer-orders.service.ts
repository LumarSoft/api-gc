import { Injectable, NotFoundException } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { PrismaService } from '../prisma/prisma.service'
import type { ListMyOrdersDto } from './dto/order-input.dto'
import type { MyOrdersPageDto, OrderResponseDto } from './dto/order-response.dto'
import { orderSelect } from './lib/order-selects'
import { OrderMapper } from './order.mapper'

/**
 * Orders placed while signed in, for the account area. Ownership is `Order.userId` only: guest orders with the same
 * email are not linked, because a typed email at checkout does not prove who owns it.
 */
@Injectable()
export class CustomerOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: OrderMapper,
  ) {}

  async list(user: AuthenticatedUser, query: ListMyOrdersDto): Promise<MyOrdersPageDto> {
    const where = { userId: user.id }
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: orderSelect,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.order.count({ where }),
    ])
    return {
      items: rows.map(row => this.mapper.response(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    }
  }

  /** Someone else's order answers exactly like a missing one, so numbers cannot be probed. */
  async read(user: AuthenticatedUser, number: string): Promise<OrderResponseDto> {
    const row = await this.prisma.order.findFirst({ where: { number, userId: user.id }, select: orderSelect })
    if (!row) throw new NotFoundException('No encontramos este pedido en tu cuenta.')
    return this.mapper.response(row)
  }
}
