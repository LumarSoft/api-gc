import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { resolve } from 'node:path'
import { Currency, OrderStatus, ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { migrationStatus } from '../prisma/migration-check'
import { outOfStockWhere } from '../products/lib/admin-product-filters'
import type { SystemStatusDto } from './dto/system-status.dto'
import { codeVersion, diskUsage, machineUsage, type CodeVersion } from './lib/system-runtime'
import { SystemIntegrationsService } from './system-integrations.service'
import { SystemLogsService } from './system-logs.service'

const DAY_MS = 24 * 60 * 60 * 1000
/** The expiry job runs every minute: an order this late means the job is not keeping up. */
const OVERDUE_GRACE_MS = 2 * 60 * 1000
/** Where `OrderExpiryService` writes how its last run went. */
const EXPIRY_JOB_SETTING = 'orders.expiryJob'

/** The developers' "Sistema" page: one read of how the API, its integrations, its tasks and the store are doing. */
@Injectable()
export class AdminSystemService implements OnModuleInit {
  private version: CodeVersion | null = null
  private readonly startedAt = new Date(Date.now() - process.uptime() * 1000)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly integrations: SystemIntegrationsService,
    private readonly logs: SystemLogsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.version = await codeVersion()
  }

  async status(now = new Date()): Promise<SystemStatusDto> {
    const [database, disk, integrations, logs, jobs, store] = await Promise.all([
      this.database(),
      diskUsage(resolve(this.config.get<string>('STORAGE_DIR') ?? 'storage')),
      this.integrations.status(now),
      this.logs.summary(now),
      this.jobs(now),
      this.store(),
    ])
    return {
      checkedAt: now.toISOString(),
      environment: this.config.get<string>('NODE_ENV') ?? 'development',
      api: {
        version: this.version,
        startedAt: this.startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        machine: machineUsage(),
        disk,
      },
      database,
      integrations,
      logs,
      jobs,
      store,
    }
  }

  private async database(): Promise<SystemStatusDto['database']> {
    const started = performance.now()
    await this.prisma.$queryRaw`SELECT 1`
    const latencyMs = Math.round((performance.now() - started) * 10) / 10
    return { latencyMs, migrations: await migrationStatus(this.prisma) }
  }

  private async jobs(now: Date): Promise<SystemStatusDto['jobs']> {
    const [setting, expiredLast24h, overdue] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: EXPIRY_JOB_SETTING }, select: { value: true } }),
      this.prisma.orderStatusHistory.count({
        where: {
          toStatus: OrderStatus.EXPIRED,
          changedById: null,
          createdAt: { gte: new Date(now.getTime() - DAY_MS) },
        },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.PENDING_PAYMENT,
          expiresAt: { lte: new Date(now.getTime() - OVERDUE_GRACE_MS) },
        },
      }),
    ])
    const health = expiryJobHealth(setting?.value)
    return { orderExpiry: { ...health, expiredLast24h, overdue } }
  }

  private async store(): Promise<SystemStatusDto['store']> {
    const published = { deletedAt: null, status: ProductStatus.PUBLISHED }
    const [rate, publishedWithoutImages, publishedOutOfStock, awaitingPayment] = await Promise.all([
      this.prisma.exchangeRate.findFirst({
        where: { currency: Currency.USD, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
        select: { rate: true, effectiveFrom: true },
      }),
      this.prisma.product.count({ where: { ...published, images: { none: { deletedAt: null } } } }),
      this.prisma.product.count({
        where: { AND: [published, outOfStockWhere(this.prisma.inventoryLevel.fields.reserved)] },
      }),
      this.prisma.order.count({ where: { status: OrderStatus.PENDING_PAYMENT } }),
    ])
    return {
      exchangeRate: rate ? { rate: rate.rate.toFixed(2), effectiveFrom: rate.effectiveFrom.toISOString() } : null,
      publishedWithoutImages,
      publishedOutOfStock,
      awaitingPayment,
    }
  }
}

/** `Setting` `orders.expiryJob` as `OrderExpiryService` writes it: `{ failed, lastRunAt }`. */
export function expiryJobHealth(value: unknown): { lastRunAt: string | null; failed: boolean } {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    lastRunAt: typeof record.lastRunAt === 'string' ? record.lastRunAt : null,
    failed: record.failed === true,
  }
}
