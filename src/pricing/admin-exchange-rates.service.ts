import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { BuyerType, Currency, DataSource } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { CreateExchangeRateDto, ExchangeRateDto, ExchangeRatesResponseDto, PriceListDto } from './dto/admin-pricing.dto'
import { exchangeRateError } from './lib/exchange-rate-rules'

const RATE_SELECT = {
  id: true,
  currency: true,
  rate: true,
  source: true,
  effectiveFrom: true,
  createdAt: true,
} as const

type RateRow = Prisma.ExchangeRateGetPayload<{ select: typeof RATE_SELECT }>

/** Price lists and the USD exchange rate, as seen from the admin panel. */
@Injectable()
export class AdminExchangeRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Retail first, then "clientes frecuentes". A short, bounded list. */
  async priceLists(): Promise<PriceListDto[]> {
    const lists = await this.prisma.priceList.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, name: true, audience: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    })
    return lists.sort((a, b) => Number(b.audience === BuyerType.RETAIL) - Number(a.audience === BuyerType.RETAIL))
  }

  async list(limit: number): Promise<ExchangeRatesResponseDto> {
    const now = new Date()
    const [history, scheduled] = await Promise.all([
      this.prisma.exchangeRate.findMany({
        where: { currency: Currency.USD, effectiveFrom: { lte: now } },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
        take: limit,
        select: RATE_SELECT,
      }),
      this.prisma.exchangeRate.findMany({
        where: { currency: Currency.USD, effectiveFrom: { gt: now } },
        orderBy: { effectiveFrom: 'asc' },
        select: RATE_SELECT,
      }),
    ])
    const items = history.map(row => this.toDto(row))
    return { current: items[0] ?? null, scheduled: scheduled.map(row => this.toDto(row)), history: items }
  }

  /** Append-only: a new row; the current rate is the latest one already in effect (PricingService.getContext). */
  async create(dto: CreateExchangeRateDto, actor: AuditActor): Promise<ExchangeRatesResponseDto> {
    const rate = new Prisma.Decimal(dto.rate)
    const now = new Date()
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : now
    const error = exchangeRateError(rate, effectiveFrom, now)
    if (error) throw new BadRequestException(error)

    await this.prisma.$transaction(async tx => {
      const row = await tx.exchangeRate.create({
        data: { currency: dto.currency, rate, effectiveFrom, source: DataSource.MANUAL },
        select: { id: true },
      })
      await this.auditLogs.record(
        actor,
        {
          action: 'exchange-rate.create',
          entityType: 'ExchangeRate',
          entityId: row.id,
          changes: {
            rate: { from: null, to: rate.toFixed(4) },
            effectiveFrom: { from: null, to: effectiveFrom.toISOString() },
          },
        },
        tx,
      )
    })
    return this.list(20)
  }

  private toDto(row: RateRow): ExchangeRateDto {
    return { ...row, rate: row.rate.toFixed(4) }
  }
}
