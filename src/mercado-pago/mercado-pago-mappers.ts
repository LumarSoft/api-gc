import { createHmac, timingSafeEqual } from 'node:crypto'
import { PaymentStatus } from '../generated/prisma/enums'
import type { CheckoutRequest, GatewayPayment } from './payment-gateway'
import type { MercadoPagoPayment } from './mercado-pago-types'

/** Mercado Pago payment states, by what they mean for the order. */
const STATUSES: Record<string, PaymentStatus> = {
  pending: PaymentStatus.PENDING,
  authorized: PaymentStatus.PENDING,
  in_process: PaymentStatus.IN_REVIEW,
  in_mediation: PaymentStatus.IN_REVIEW,
  approved: PaymentStatus.APPROVED,
  rejected: PaymentStatus.REJECTED,
  cancelled: PaymentStatus.CANCELLED,
  refunded: PaymentStatus.REFUNDED,
  charged_back: PaymentStatus.REFUNDED,
}

export interface PreferenceOptions {
  /** Our reference with the environment prefix. */
  externalReference: string
  /** Public URL of our webhook, when there is one (locally there is usually none). */
  notificationUrl: string | null
}

/**
 * Checkout Pro preference. `binary_mode` makes every payment approved or rejected at once (no cash vouchers or
 * manual reviews that resolve days later), so a payment never outlives the stock reservation it pays for.
 */
export function preferenceBody(request: CheckoutRequest, options: PreferenceOptions): object {
  const secure = request.returnUrl.startsWith('https://')
  return {
    items: request.lines.map(line => ({
      id: line.id,
      title: line.title,
      quantity: line.quantity,
      // The API takes numbers; amounts have two decimals and stay far below 2^53, so the conversion is exact.
      unit_price: Number(line.unitPrice),
      currency_id: 'ARS',
    })),
    payer: { name: request.payer.name, email: request.payer.email },
    external_reference: options.externalReference,
    back_urls: { success: request.returnUrl, pending: request.returnUrl, failure: request.returnUrl },
    // Mercado Pago only redirects on its own to https URLs; locally the buyer uses "Volver al sitio".
    ...(secure ? { auto_return: 'approved' } : {}),
    // Only signed webhooks (no legacy IPN, which has no signature).
    ...(options.notificationUrl ? { notification_url: `${options.notificationUrl}?source_news=webhooks` } : {}),
    binary_mode: true,
    expires: true,
    expiration_date_to: request.expiresAt.toISOString(),
  }
}

/** Our view of a Mercado Pago payment; references with another environment's prefix are not ours. */
export function gatewayPayment(payment: MercadoPagoPayment, prefix: string): GatewayPayment | null {
  if (typeof payment.id !== 'number' || typeof payment.status !== 'string') return null
  const reference = payment.external_reference ?? ''
  return {
    id: String(payment.id),
    reference: reference.startsWith(prefix) && reference.length > prefix.length ? reference.slice(prefix.length) : null,
    status: STATUSES[payment.status] ?? PaymentStatus.PENDING,
    externalStatus: payment.status.slice(0, 60),
    externalStatusDetail: payment.status_detail?.slice(0, 120) ?? null,
    amount: (payment.transaction_amount ?? 0).toFixed(2),
    currency: payment.currency_id ?? '',
    installments: payment.installments ?? null,
    approvedAt: payment.date_approved ? new Date(payment.date_approved) : null,
  }
}

/**
 * Checks Mercado Pago's `x-signature` (`ts=…,v1=…`): HMAC-SHA256 with the webhook secret of
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, where parts missing from the request are left out and an
 * alphanumeric id is lowercased.
 */
export function validSignature(
  secret: string,
  signature: string | undefined,
  requestId: string | undefined,
  dataId: string | null,
): boolean {
  if (!secret || !signature) return false
  const parts = new Map(
    signature.split(',').map(part => {
      const [key, ...value] = part.split('=')
      return [key.trim(), value.join('=').trim()] as const
    }),
  )
  const ts = parts.get('ts')
  const given = parts.get('v1')
  if (!ts || !given) return false
  const manifest = [
    dataId ? `id:${dataId.toLowerCase()};` : '',
    requestId ? `request-id:${requestId};` : '',
    `ts:${ts};`,
  ].join('')
  const expected = Buffer.from(createHmac('sha256', secret).update(manifest).digest('hex'))
  const received = Buffer.from(given)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
