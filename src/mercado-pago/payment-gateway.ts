import type { PaymentStatus } from '../generated/prisma/enums'

/** Injection token of the online payment provider. Feature modules depend on `PaymentGateway`, never on the provider. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY')

/** One line of what the buyer pays, in ARS. The amounts are the order's, computed by the backend. */
export interface CheckoutLine {
  id: string
  title: string
  quantity: number
  /** Decimal string. */
  unitPrice: string
}

export interface CheckoutRequest {
  /** Our reference (the order number); the provider returns it on every payment. */
  reference: string
  lines: CheckoutLine[]
  payer: { name: string; email: string }
  /** Where the provider sends the buyer back, whatever the outcome. */
  returnUrl: string
  /** After this the checkout no longer accepts payments. */
  expiresAt: Date
}

/** A payment as the provider reports it, read from its API (never from a redirect or the browser). */
export interface GatewayPayment {
  id: string
  /** Our reference, or null when the payment is not one of ours. */
  reference: string | null
  status: PaymentStatus
  /** The provider's own status and detail, for staff. */
  externalStatus: string
  externalStatusDetail: string | null
  /** Decimal string, without financing charges. */
  amount: string
  currency: string
  installments: number | null
  approvedAt: Date | null
}

/** What a webhook request says, once its signature is checked. */
export type GatewayNotification =
  { notificationId: string; topic: string; paymentId: string } | 'UNAUTHORIZED' | 'IGNORED'

/** The webhook request as received; the gateway checks its signature. */
export interface GatewayWebhookRequest {
  signature: string | undefined
  requestId: string | undefined
  /** Raw query string (without `?`): the signed id travels there. */
  query: string
  body: unknown
}

export interface PaymentGateway {
  /** False until the credentials are configured; online payment is then not offered. */
  readonly configured: boolean
  /** Creates a checkout and returns the URL the buyer is sent to. */
  createCheckout(request: CheckoutRequest): Promise<string>
  getPayment(id: string): Promise<GatewayPayment>
  /** Payments made for our reference, newest first. */
  findPayments(reference: string): Promise<GatewayPayment[]>
  readNotification(request: GatewayWebhookRequest): GatewayNotification
}

/**
 * Why a provider call failed, without provider details. UNAVAILABLE: timeout, network, 5xx, rate limit or our
 * credentials rejected. REJECTED: the provider refused the data. NOT_FOUND: no such payment.
 */
export class PaymentGatewayError extends Error {
  constructor(
    readonly kind: 'UNAVAILABLE' | 'REJECTED' | 'NOT_FOUND',
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}
