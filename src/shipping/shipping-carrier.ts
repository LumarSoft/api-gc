import type { ShipmentStatus } from '../generated/prisma/enums'

/** Injection token of the carrier provider. Feature modules depend on `ShippingCarrier`, never on the provider. */
export const SHIPPING_CARRIER = Symbol('SHIPPING_CARRIER')

/** One unit of a product, as the carrier needs it to pack and quote. Weight in grams, sides in centimeters. */
export interface CarrierItem {
  sku: string
  description: string
  weightGrams: number
  heightCm: number
  widthCm: number
  lengthCm: number
}

export interface CarrierDestination {
  postalCode: string
  city: string
  province: string
}

export interface CarrierQuoteRequest {
  destination: CarrierDestination
  items: CarrierItem[]
  /** ARS amount the parcel is insured for (the goods' price). */
  declaredValue: string
}

export interface CarrierPickupPoint {
  id: number
  /** Branch name and address, ready to show. */
  description: string
}

/** One way to send the parcel. Branch delivery options come with the branches the buyer can choose from. */
export interface CarrierQuoteOption {
  carrierId: number
  carrier: string
  serviceType: string
  service: string
  logisticType: string
  /** What the buyer pays, VAT included (decimal string). */
  price: string
  /** What the store pays the provider, VAT included (decimal string). */
  cost: string
  minDays: number | null
  maxDays: number | null
  pickupPoints: CarrierPickupPoint[]
}

export interface CarrierShipmentRequest {
  /** Our reference (the order number); the provider keeps it so a retry finds the same shipment. */
  reference: string
  declaredValue: string
  items: CarrierItem[]
  carrierId: number
  serviceType: string
  logisticType: string
  recipient: {
    name: string
    /** DNI or CUIT, digits only. */
    taxId: string
    email: string
    phone: string
    street: string
    streetNumber: string
    city: string
    province: string
    postalCode: string
  }
  /** Set for branch delivery: the parcel goes to this branch instead of the address. */
  pickupPointId: number | null
}

export interface CarrierShipment {
  id: string
  reference: string
  status: ShipmentStatus
  /** The provider's wording of the status. */
  statusLabel: string
  carrier: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  /** What the store pays the provider, VAT included (decimal string), when known. */
  cost: string | null
}

export type CarrierDocumentKind = 'label' | 'guide'
export type CarrierDocumentFormat = 'pdf' | 'zpl'

export interface CarrierDocument {
  content: Buffer
  contentType: string
  fileName: string
}

/** A provider notification that something changed in one of its shipments. */
export type CarrierNotification = { shipmentId: string } | 'UNAUTHORIZED' | 'IGNORED'

export interface ShippingCarrier {
  /** False until credentials and origin are configured; quoting is then unavailable. */
  readonly configured: boolean
  quote(request: CarrierQuoteRequest): Promise<CarrierQuoteOption[]>
  createShipment(request: CarrierShipmentRequest): Promise<CarrierShipment>
  /** The shipment created with this reference, if any (to recover from a create whose answer was lost). */
  findShipment(reference: string): Promise<CarrierShipment | null>
  getShipment(id: string): Promise<CarrierShipment>
  /** Cancels before dispatch; after it the provider can only try to stop it ("rescue"). */
  cancelShipment(id: string): Promise<'CANCELLED' | 'RESCUE_REQUESTED'>
  document(id: string, kind: CarrierDocumentKind, format: CarrierDocumentFormat): Promise<CarrierDocument>
  readNotification(token: string, body: unknown): CarrierNotification
}

/**
 * Why a provider call failed, without provider details. Services turn it into the HTTP error that fits their caller.
 * UNAVAILABLE: timeout, network, 5xx, rate limit or our credentials rejected. REJECTED: the provider refused the data.
 * NOT_READY: the document is not generated yet.
 */
export class CarrierError extends Error {
  constructor(
    readonly kind: 'UNAVAILABLE' | 'REJECTED' | 'NOT_FOUND' | 'NOT_READY',
    message: string,
  ) {
    super(message)
  }
}
