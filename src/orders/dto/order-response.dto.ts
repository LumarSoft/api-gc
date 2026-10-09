import type { DeliveryMethod, OrderStatus, PaymentMethod, ShipmentStatus } from '../../generated/prisma/enums'
import type { ShipmentAction } from '../lib/order-rules'
import type { MoneyDto } from '../../pricing/pricing.service'

export interface OrderResponseDto {
  id: number
  number: string
  status: OrderStatus
  deliveryMethod: DeliveryMethod
  paymentMethod: PaymentMethod
  subtotal: MoneyDto
  shippingTotal: MoneyDto
  total: MoneyDto
  placedAt: string
  expiresAt: string | null
  customer: { name: string; email: string; phone: string | null }
  shippingAddress: {
    street: string | null
    streetNumber: string | null
    city: string | null
    province: string | null
    postalCode: string | null
  } | null
  items: {
    name: string
    variantName: string | null
    sku: string
    quantity: number
    unitPrice: MoneyDto
    total: MoneyDto
    /** The product's current first image (not a purchase-time snapshot); null when it has none. */
    imageUrl: string | null
  }[]
  /** The carrier shipment (CARRIER delivery); null for pickup and Rosario delivery. */
  shipment: {
    status: ShipmentStatus
    carrier: string | null
    service: string | null
    /** The carrier's own wording of the status. */
    carrierStatus: string | null
    trackingNumber: string | null
    trackingUrl: string | null
    /** Branch where the buyer picks it up (branch delivery). */
    pickupPoint: string | null
    /** What staff can do with it. Only included in admin responses. */
    actions?: ShipmentAction[]
  } | null
  /** `note` and `by` (staff name, null for the system) only in admin responses. */
  history: { status: OrderStatus; at: string; note?: string | null; by?: string | null }[]
  /** Placed without an account. Only included in admin responses. */
  guest?: boolean
  /** Valid next states, computed by the backend. Only included in admin responses. */
  allowedStatuses?: OrderStatus[]
}

export interface OrdersPageDto {
  items: OrderResponseDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  expiryJobFailed: boolean
}

/** The signed-in customer's orders, newest first. */
export interface MyOrdersPageDto {
  items: OrderResponseDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Orders that need staff action, per open stage. */
export interface OrderCountsDto {
  PENDING_PAYMENT: number
  TO_FULFILL: number
  READY: number
}
