import type { MoneyDto } from '../../pricing/pricing.service'

/** One metric over the last period and the one before, plus its daily values (oldest first). */
export interface DashboardMetricDto<TValue> {
  current: TValue
  previous: TValue
}

export interface AdminDashboardDto {
  /** Argentine calendar days of the period, oldest first (both ends of the requested range included). */
  days: string[]
  /** Paid orders (confirmed by staff), by confirmation date. ARS. */
  sales: DashboardMetricDto<MoneyDto> & { daily: string[] }
  /** Orders placed, whatever happened to them later, by placement date. */
  orders: DashboardMetricDto<number> & { daily: number[] }
  /** Sales divided by paid orders; null without paid orders. */
  averageOrder: DashboardMetricDto<MoneyDto | null>
  /** Work waiting outside orders (orders have GET /admin/orders/counts). */
  todo: {
    /** Frequent-customer applications to review. */
    wholesalePending: number
    /** Published products without stock left. */
    publishedOutOfStock: number
    drafts: number
  }
}
