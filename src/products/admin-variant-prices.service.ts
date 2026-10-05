import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { DataSource } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { VariantPriceInputDto } from './dto/admin/replace-variant-prices.dto'
import { pricesError } from './lib/variant-rules'

/**
 * Manual prices of a variant, one per price list (retail, "clientes frecuentes"…), each in ARS or USD.
 * USD prices are converted to ARS when shown, with the current exchange rate (PricingService).
 */
@Injectable()
export class AdminVariantPricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async replace(variantId: number, prices: VariantPriceInputDto[], actor: AuditActor): Promise<void> {
    const error = pricesError(prices)
    if (error) throw new BadRequestException(error)
    const listIds = prices.map(price => price.priceListId)
    const lists = await this.prisma.priceList.count({ where: { id: { in: listIds }, deletedAt: null } })
    if (lists !== listIds.length) throw new BadRequestException('Some price lists do not exist')
    const before = await this.prisma.variantPrice.findMany({
      where: { variantId, deletedAt: null },
      select: { priceListId: true, amount: true, currency: true },
    })

    await this.prisma.$transaction(async tx => {
      await tx.variantPrice.updateMany({
        where: { variantId, deletedAt: null, priceListId: { notIn: listIds } },
        data: { deletedAt: new Date() },
      })
      for (const price of prices) {
        const data = {
          amount: new Prisma.Decimal(price.amount),
          currency: price.currency,
          compareAtAmount: price.compareAtAmount ? new Prisma.Decimal(price.compareAtAmount) : null,
          // A price edited here is manual from now on: the Tango sync must not overwrite it (pricing.prisma).
          source: DataSource.MANUAL,
          deletedAt: null,
        }
        // One row per variant and list (unique): a removed price is restored instead of duplicated.
        await tx.variantPrice.upsert({
          where: { variantId_priceListId: { variantId, priceListId: price.priceListId } },
          create: { ...data, variantId, priceListId: price.priceListId },
          update: data,
        })
      }
      await this.auditLogs.record(
        actor,
        {
          action: 'variant.prices',
          entityType: 'ProductVariant',
          entityId: variantId,
          changes: {
            prices: {
              from: before.map(price => `${price.priceListId}:${price.currency} ${price.amount.toFixed(2)}`),
              to: prices.map(
                price => `${price.priceListId}:${price.currency} ${new Prisma.Decimal(price.amount).toFixed(2)}`,
              ),
            },
          },
        },
        tx,
      )
    })
  }
}
