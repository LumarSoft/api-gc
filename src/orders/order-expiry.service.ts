import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { OrderStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { OrderStatusService } from './order-status.service'

@Injectable()
export class OrderExpiryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private readonly logger = new Logger(OrderExpiryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly statuses: OrderStatusService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), 60_000)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async run(): Promise<void> {
    if (this.running) return
    this.running = true
    let failed = false
    try {
      const orders = await this.prisma.order.findMany({
        where: { status: OrderStatus.PENDING_PAYMENT, expiresAt: { lte: new Date() } },
        orderBy: { expiresAt: 'asc' },
        take: 100,
        select: { id: true },
      })
      for (const order of orders) {
        try {
          await this.statuses.change(order.id, { status: OrderStatus.EXPIRED })
        } catch {
          // A concurrent confirmation/cancellation can win the order lock. Only still-overdue rows indicate failure.
          const overdue = await this.prisma.order.count({
            where: { id: order.id, status: OrderStatus.PENDING_PAYMENT, expiresAt: { lte: new Date() } },
          })
          if (overdue) {
            failed = true
            this.logger.error(`Could not release expired order ${order.id}`)
          }
        }
      }
    } catch {
      failed = true
      this.logger.error('Could not run order reservation expiration')
    } finally {
      try {
        await this.prisma.setting.upsert({
          where: { key: 'orders.expiryJob' },
          create: { key: 'orders.expiryJob', value: { failed, lastRunAt: new Date().toISOString() } },
          update: { value: { failed, lastRunAt: new Date().toISOString() }, deletedAt: null },
        })
      } catch {
        this.logger.error('Could not persist reservation expiration health')
      }
      this.running = false
    }
  }
}
