import { ShipmentStatus } from '../../generated/prisma/enums'
import type {
  CarrierItem,
  CarrierQuoteOption,
  CarrierQuoteRequest,
  CarrierShipment,
  CarrierShipmentRequest,
} from '../shipping-carrier'
import type { ZipnovaPickupPoint, ZipnovaQuoteResponse, ZipnovaShipment } from './zipnova-types'

/** Shown in Zipnova's panel and usable in its rules engine to tell our orders apart. */
export const ZIPNOVA_SOURCE = 'comunicaciones-graficas-web'
/** "General" product classification (Zipnova reference table). */
const GENERAL_CLASSIFICATION = 1
/** Zipnova refuses items lighter than this. */
const MIN_ITEM_GRAMS = 10
const PICKUP_POINT = 'pickup_point'

/** Zipnova status codes (docs: referencia/estados-de-envio) grouped into our coarse states. */
const STATUS_GROUPS: Record<ShipmentStatus, string[]> = {
  PENDING: ['new', 'documentation_ready', 'ready_to_ship'],
  IN_TRANSIT: [
    'shipped',
    'in_transit_to_crossdock',
    'admitted',
    'xd_pending',
    'crossdock',
    'in_transit_to_carrier',
    'received_by_carrier',
    'rejected',
    'reshipped',
    'in_transit',
    'delivery_attempt',
    'out_for_delivery',
    'not_delivered',
  ],
  READY_FOR_PICKUP: ['available_for_pickup'],
  DELIVERED: ['delivered', 'delivered_with_damage'],
  RETURNED: [
    'in_carrier_ready_to_return',
    'generated_return',
    'return_xd_pending',
    'on_hold_crossdock',
    'in_transit_to_seller',
    'returned_to_seller',
  ],
  CANCELLED: ['cancelled', 'expired'],
  LOST: ['lost', 'lost_in_carrier'],
}

/** Unknown codes (a status Zipnova adds later) count as in transit: never as delivered or cancelled. */
export function shipmentStatus(code: string): ShipmentStatus {
  const entry = Object.entries(STATUS_GROUPS).find(([, codes]) => codes.includes(code))
  return entry ? (entry[0] as ShipmentStatus) : ShipmentStatus.IN_TRANSIT
}

function zipnovaItems(items: CarrierItem[]): object[] {
  return items.map(item => ({
    sku: item.sku,
    description: item.description,
    weight: Math.max(MIN_ITEM_GRAMS, item.weightGrams),
    height: item.heightCm,
    width: item.widthCm,
    length: item.lengthCm,
    classification_id: GENERAL_CLASSIFICATION,
  }))
}

export function quoteBody(accountId: number, originId: number, request: CarrierQuoteRequest): object {
  return {
    account_id: accountId,
    origin_id: originId,
    source: ZIPNOVA_SOURCE,
    declared_value: Number(request.declaredValue),
    destination: {
      zipcode: request.destination.postalCode,
      city: request.destination.city,
      state: request.destination.province,
    },
    items: zipnovaItems(request.items),
    type_packaging: 'dynamic',
  }
}

function pickupPointDescription(point: ZipnovaPickupPoint): string {
  const location = point.location
  const address = [
    [location?.street, location?.street_number].filter(Boolean).join(' '),
    location?.city,
    location?.state,
  ]
    .filter(Boolean)
    .join(', ')
  return [point.description, address].filter(Boolean).join(' — ').slice(0, 255)
}

/**
 * One option per delivery mode, as Zipnova ranked them. Options it marks as not selectable are dropped, and so is
 * branch delivery without branches: it could not be booked (Zipnova needs the branch).
 */
export function quoteOptions(response: ZipnovaQuoteResponse | null): CarrierQuoteOption[] {
  return Object.values(response?.results ?? {})
    .filter(result => result.selectable)
    .filter(result => result.service_type.code !== PICKUP_POINT || Boolean(result.pickup_points?.length))
    .map(result => ({
      carrierId: result.carrier.id,
      carrier: result.carrier.name,
      serviceType: result.service_type.code,
      service: result.service_type.name,
      logisticType: result.logistic_type,
      price: result.amounts.price_incl_tax.toFixed(2),
      cost: result.amounts.seller_price_incl_tax.toFixed(2),
      minDays: result.delivery_time?.min ?? null,
      maxDays: result.delivery_time?.max ?? null,
      pickupPoints: (result.pickup_points ?? []).map(point => ({
        id: point.point_id,
        description: pickupPointDescription(point),
      })),
    }))
}

export function shipmentBody(accountId: number, originId: number, request: CarrierShipmentRequest): object {
  const { recipient } = request
  return {
    account_id: accountId,
    origin_id: originId,
    external_id: request.reference,
    source: ZIPNOVA_SOURCE,
    carrier_id: request.carrierId,
    service_type: request.serviceType,
    logistic_type: request.logisticType,
    declared_value: Number(request.declaredValue),
    type_packaging: 'dynamic',
    items: zipnovaItems(request.items),
    destination: {
      name: recipient.name,
      document: recipient.taxId,
      email: recipient.email,
      phone: recipient.phone,
      street: recipient.street,
      street_number: recipient.streetNumber,
      city: recipient.city,
      state: recipient.province,
      zipcode: recipient.postalCode,
      ...(request.pickupPointId ? { point_id: request.pickupPointId } : {}),
    },
  }
}

export function carrierShipment(shipment: ZipnovaShipment): CarrierShipment {
  return {
    id: String(shipment.id),
    reference: shipment.external_id,
    status: shipmentStatus(shipment.status),
    statusLabel: shipment.status_name || shipment.status,
    carrier: shipment.carrier?.name ?? null,
    trackingNumber: shipment.carrier_tracking_id || null,
    trackingUrl: shipment.tracking || null,
  }
}
