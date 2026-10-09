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
  /** Zipnova's guide number (printed on the label, e.g. "0999-31404615"); the carrier's own number comes later. */
  delivery_id?: string | null
  /** Zipnova's public tracking page. */
  tracking?: string | null
}

export interface ZipnovaShipmentList {
  data?: ZipnovaShipment[] | null
}

/** Answer of `GET /shipments/{id}/{label|document}.{pdf|zpl}` (checked in test mode, 2026-10-09). */
export interface ZipnovaDocument {
  format?: string | null
  /** The file in base64. */
  body?: string | null
}
