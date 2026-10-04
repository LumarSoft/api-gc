import { Injectable } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { Prisma } from '../generated/prisma/client'
import { BuyerType, Currency } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'

export interface MoneyDto {
  /** Decimal string with 2 decimals, e.g. "419999.00". */
  amount: string
  currency: Currency
}

/** Who is buying and at which rate, resolved once per request and reused for every product in a response. */
export interface PriceContext {
  /** Price lists to use, in order of preference (e.g. the company's list, then the default retail list). */
  priceListIds: number[]
  /** ARS per USD, or null when no exchange rate has been loaded yet. */
  usdRate: Prisma.Decimal | null
}

export interface VariantPriceRow {
  priceListId: number
  amount: Prisma.Decimal
  currency: Currency
  compareAtAmount: Prisma.Decimal | null
}

export interface ResolvedPrice {
  price: MoneyDto
  compareAtPrice: MoneyDto | null
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async getContext(user: AuthenticatedUser | undefined): Promise<PriceContext> {
    const [defaultLists, company, rate] = await Promise.all([
      this.prisma.priceList.findMany({
        where: { isDefault: true, deletedAt: null },
        select: { id: true, audience: true },
      }),
      user?.buyerType === BuyerType.WHOLESALE && user.companyId
        ? this.prisma.company.findUnique({ where: { id: user.companyId }, select: { priceListId: true } })
        : null,
      this.prisma.exchangeRate.findFirst({
        where: { currency: Currency.USD, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
        select: { rate: true },
      }),
    ])

    const defaultFor = (audience: BuyerType): number | undefined =>
      defaultLists.find(list => list.audience === audience)?.id
    const retailListId = defaultFor(BuyerType.RETAIL)
    const wholesaleListId =
      user?.buyerType === BuyerType.WHOLESALE ? (company?.priceListId ?? defaultFor(BuyerType.WHOLESALE)) : undefined

    // A wholesale customer falls back to the retail price for products without a wholesale price.
    const priceListIds = [wholesaleListId, retailListId].filter((id): id is number => id !== undefined)
    return { priceListIds, usdRate: rate?.rate ?? null }
  }

  /** Picks the price from the first applicable list and shows it in ARS. Returns null when the variant has no price. */
  resolve(prices: VariantPriceRow[], context: PriceContext): ResolvedPrice | null {
    for (const listId of context.priceListIds) {
      const row = prices.find(price => price.priceListId === listId)
      if (!row) continue
      return {
        price: this.toDisplayMoney(row.amount, row.currency, context),
        compareAtPrice: row.compareAtAmount ? this.toDisplayMoney(row.compareAtAmount, row.currency, context) : null,
      }
    }
    return null
  }

  /** USD prices are shown in ARS at the current rate. Without a rate they stay in USD rather than show a wrong number. */
  private toDisplayMoney(amount: Prisma.Decimal, currency: Currency, context: PriceContext): MoneyDto {
    if (currency === Currency.USD && context.usdRate) {
      const converted = amount.mul(context.usdRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      return { amount: converted.toFixed(2), currency: Currency.ARS }
    }
    return { amount: amount.toFixed(2), currency }
  }
}
