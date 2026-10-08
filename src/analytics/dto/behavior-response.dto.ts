import type { AnalyticsPeriod } from '../lib/analytics-period'
import type { Bucket } from '../lib/analytics-buckets'
import type { Funnel } from '../lib/behavior-rules'
import type { ComparedDto } from './analytics-response.dto'

/** A product in a stats row: name, first image and whether it was archived since. */
export interface AnalyticsProductDto {
  id: number
  name: string
  imageUrl: string | null
  archived: boolean
}

export interface SearchRowDto {
  /** Normalized text (lowercase, single spaces). */
  query: string
  searches: number
  visitors: number
  /** Most products a search with this text found. */
  results: number
}

/** What anonymous visitors did in the store over a period, against the previous one. */
export interface AdminBehaviorDto {
  period: AnalyticsPeriod['summary']
  buckets: Bucket[]
  /** Argentine day of the first recorded event; null before any. Earlier days have no data, not zero activity. */
  trackingSince: string | null
  /** Distinct visitors (anonymous browser ids), and per chart point. */
  visitors: ComparedDto<number> & { series: ComparedDto<number[]> }
  funnel: ComparedDto<Funnel>
  /** Most viewed products of the period (distinct visitors), with how many added them and units sold. */
  products: (AnalyticsProductDto & { viewers: number; addedToCart: number; unitsSold: number })[]
  searches: {
    total: ComparedDto<number>
    withoutResults: ComparedDto<number>
    top: SearchRowDto[]
    /** Texts that never found a product. */
    unanswered: SearchRowDto[]
  }
  carts: {
    /** Carts with products, untouched for `abandonAfterHours` and never ordered, by last activity. */
    abandoned: ComparedDto<number>
    /** Orders placed (every order comes from a cart). */
    ordersPlaced: ComparedDto<number>
    abandonAfterHours: number
    /** Products left most often in abandoned carts of the period. */
    products: (AnalyticsProductDto & { carts: number; units: number })[]
  }
}
