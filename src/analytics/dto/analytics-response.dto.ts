import type { BuyerType, DeliveryMethod, PaymentMethod } from '../../generated/prisma/enums'
import type { MoneyDto } from '../../pricing/pricing.service'
import type { Bucket, GroupBy } from '../lib/analytics-buckets'
import type { OrderOutcomes } from '../lib/analytics-rules'

/** A value in the period and in the previous one, of the same length. */
export interface ComparedDto<T> {
  current: T
  previous: T
}

/** Paid orders and sales of one value (a buyer type, a payment method…), with the previous period's sales. */
export interface AnalyticsMixRowDto<K extends string> {
  key: K
  orders: number
  sales: MoneyDto
  previousSales: MoneyDto
}

/** Units and sales of products (lines' totals, before order discounts and without shipping). */
export interface AnalyticsRankRowDto {
  id: number | null
  name: string
  units: number
  sales: MoneyDto
  previousSales: MoneyDto
  previousUnits: number
}

export interface AnalyticsProductRowDto extends AnalyticsRankRowDto {
  id: number
  imageUrl: string | null
  /** Archived since it sold: the admin has no page for it. */
  archived: boolean
}

/** Store stats over a period against the previous one. Money is ARS; sales are paid orders by payment date. */
export interface AdminAnalyticsDto {
  period: { from: string; to: string; previousFrom: string; previousTo: string; groupBy: GroupBy }
  /** Chart points, oldest first. Every `series` below has one value per bucket. */
  buckets: Bucket[]
  sales: ComparedDto<MoneyDto> & { series: ComparedDto<string[]> }
  /** Products before discounts, discounts and shipping: products − discounts + shipping = sales. */
  breakdown: { products: ComparedDto<MoneyDto>; discounts: ComparedDto<MoneyDto>; shipping: ComparedDto<MoneyDto> }
  /** Paid orders. */
  orders: ComparedDto<number> & { series: ComparedDto<number[]> }
  averageOrder: ComparedDto<MoneyDto | null>
  /** Orders placed in the period, by what became of them. */
  outcomes: ComparedDto<OrderOutcomes>
  /** Median hours from placing an order to its confirmed payment. */
  hoursToPay: ComparedDto<number | null>
  buyerTypes: AnalyticsMixRowDto<BuyerType>[]
  paymentMethods: AnalyticsMixRowDto<PaymentMethod>[]
  deliveryMethods: AnalyticsMixRowDto<DeliveryMethod>[]
  /** Top 10 by sales (then units). */
  products: AnalyticsProductRowDto[]
  /** Top 10 by units (then sales): what moves most, whatever its price (ink next to printers). */
  productsByUnits: AnalyticsProductRowDto[]
  /** Top-level categories (a subcategory's sales count for its parent). */
  categories: AnalyticsRankRowDto[]
  /** `id: null` = products without a brand. */
  brands: AnalyticsRankRowDto[]
  customers: {
    /** Customers (told apart by email) with a paid order. */
    total: ComparedDto<number>
    /** Of those, the ones who had paid an order before. */
    returning: ComparedDto<number>
    newSales: MoneyDto
    returningSales: MoneyDto
    /** Customer accounts created. */
    signUps: ComparedDto<number>
    frequentCustomerApplications: {
      received: ComparedDto<number>
      /** Approved in the period and still approved. */
      approved: ComparedDto<number>
      /** Waiting for review now, whatever the period. */
      pending: number
    }
  }
}
