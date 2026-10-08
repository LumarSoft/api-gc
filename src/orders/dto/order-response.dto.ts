import type { DeliveryMethod, OrderStatus, PaymentMethod } from '../../generated/prisma/enums'
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
  }[]
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

/** Orders that need staff action, per open stage. */
export interface OrderCountsDto {
  PENDING_PAYMENT: number
  TO_FULFILL: number
  READY: number
}
