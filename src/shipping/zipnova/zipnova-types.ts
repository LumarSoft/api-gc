/**
 * The parts of Zipnova API v2 responses we read (https://docs.zipnova.com/envios). They stay inside this folder:
 * the rest of the app only sees the types in `shipping-carrier.ts`.
 */

export interface ZipnovaQuoteResult {
  selectable: boolean
  logistic_type: string
  carrier: { id: number; name: string }
  service_type: { code: string; name: string }
  delivery_time?: { min?: number | null; max?: number | null } | null
  amounts: { price_incl_tax: number; seller_price_incl_tax: number }
  pickup_points?: ZipnovaPickupPoint[] | null
}

export interface ZipnovaPickupPoint {
  point_id: number
  description?: string | null
  location?: {
    street?: string | null
    street_number?: string | null
    city?: string | null
    state?: string | null
  } | null
}

export interface ZipnovaQuoteResponse {
  /** The winning option per delivery mode, chosen by the account's selection setting (price, rating or time). */
  results?: Record<string, ZipnovaQuoteResult> | null
}

export interface ZipnovaShipment {
  id: number
  external_id: string
  status: string
  status_name?: string | null
  carrier?: { name?: string | null } | null
  carrier_tracking_id?: string | null
  /** Zipnova's public tracking page. */
  tracking?: string | null
  price_incl_tax?: number | null
}

export interface ZipnovaShipmentList {
  data?: ZipnovaShipment[] | null
}

export interface ZipnovaDocument {
  /** Base64 of the file. */
  content?: string | null
  data?: string | null
  file?: string | null
}
