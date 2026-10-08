import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { Currency } from '../generated/prisma/enums'
import type { MoneyDto } from '../pricing/pricing.service'
import type {
  AdminAnalyticsDto,
  AnalyticsMixRowDto,
  AnalyticsRankRowDto,
  ComparedDto,
} from './dto/analytics-response.dto'
import { type MixRow, type RankRow, sumLines, topRows } from './lib/analytics-rules'
import type { ProductSummary, SoldVariant } from './lib/analytics-selects'

type Decimal = Prisma.Decimal

export interface SoldVariantLine {
  variant: SoldVariant
  units: number
  sales: Decimal
}

/** Rows shown per ranking. */
const TOP_PRODUCTS = 10
const TOP_GROUPS = 8

/** Turns the analytics aggregates into the response: money as ARS strings, rankings with names and images. */
@Injectable()
export class AnalyticsMapper {
  constructor(private readonly files: FilesService) {}

  /** Id, name, first image and archived flag of a product in a stats row. */
  productSummary(product: ProductSummary): { id: number; name: string; imageUrl: string | null; archived: boolean } {
    const image = product.images[0]
    return {
      id: product.id,
      name: product.name,
      imageUrl: image ? this.files.publicUrl(image.file.storageKey) : null,
      archived: product.deletedAt !== null,
    }
  }

  readonly decimal = (value: Decimal): string => value.toFixed(2)

  readonly money = (value: Decimal): MoneyDto => ({ amount: value.toFixed(2), currency: Currency.ARS })

  comparedMoney(value: ComparedDto<Decimal>): ComparedDto<MoneyDto> {
    return { current: this.money(value.current), previous: this.money(value.previous) }
  }

  /** Sales divided by paid orders; null without orders (never a division by zero). */
  average(sales: Decimal, orders: number): MoneyDto | null {
    return orders > 0 ? this.money(sales.dividedBy(orders)) : null
  }

  breakdown(
    current: Record<keyof AdminAnalyticsDto['breakdown'], Decimal>,
    previous: Record<keyof AdminAnalyticsDto['breakdown'], Decimal>,
  ): AdminAnalyticsDto['breakdown'] {
    const pair = (key: keyof AdminAnalyticsDto['breakdown']) =>
      this.comparedMoney({ current: current[key], previous: previous[key] })
    return { products: pair('products'), discounts: pair('discounts'), shipping: pair('shipping') }
  }

  mix<K extends string>(rows: MixRow<K>[]): AnalyticsMixRowDto<K>[] {
    return rows.map(row => ({
      key: row.key,
      orders: row.orders,
      sales: this.money(row.sales),
      previousSales: this.money(row.previousSales),
    }))
  }

  /** Best-selling products, top-level categories and brands of the period. */
  rankings(
    current: SoldVariantLine[],
    previous: SoldVariantLine[],
  ): Pick<AdminAnalyticsDto, 'products' | 'productsByUnits' | 'categories' | 'brands'> {
    const by = <K>(lines: SoldVariantLine[], group: (variant: SoldVariant) => { key: K; name: string }) =>
      sumLines<K>(lines.map(line => ({ ...group(line.variant), units: line.units, sales: line.sales })))
    const top = <K>(
      group: (variant: SoldVariant) => { key: K; name: string },
      limit: number,
      order: 'sales' | 'units' = 'sales',
    ) => topRows(by(current, group), by(previous, group), limit, order)

    const variants = new Map(current.map(line => [line.variant.product.id, line.variant.product]))
    const productRows = (order: 'sales' | 'units') =>
      top(({ product }) => ({ key: product.id, name: product.name }), TOP_PRODUCTS, order).map(row => ({
        ...this.rankRow(row),
        ...this.productSummary(variants.get(row.key)!),
      }))
    return {
      products: productRows('sales'),
      productsByUnits: productRows('units'),
      categories: top(({ product: { category } }) => {
        const root = category.parent ?? category
        return { key: root.id, name: root.name }
      }, TOP_GROUPS).map(row => this.rankRow(row)),
      brands: top<number | null>(
        ({ product: { brand } }) => ({ key: brand?.id ?? null, name: brand?.name ?? 'Sin marca' }),
        TOP_GROUPS,
      ).map(row => this.rankRow(row)),
    }
  }

  private rankRow<K extends number | null>(row: RankRow<K>): AnalyticsRankRowDto {
    return {
      id: row.key,
      name: row.name,
      units: row.units,
      sales: this.money(row.sales),
      previousSales: this.money(row.previousSales),
      previousUnits: row.previousUnits,
    }
  }
}
