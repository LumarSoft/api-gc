import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { gatewayPayment, preferenceBody, validSignature } from './mercado-pago-mappers'
import type { MercadoPagoPayment, MercadoPagoPaymentSearch, MercadoPagoPreference } from './mercado-pago-types'
import { MercadoPagoClient } from './mercado-pago.client'
import {
  PaymentGatewayError,
  type CheckoutRequest,
  type GatewayNotification,
  type GatewayPayment,
  type GatewayWebhookRequest,
  type PaymentGateway,
} from './payment-gateway'

/** Mercado Pago sends ids as numbers or strings; anything else is not an id. */
const idText = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null

/** `PaymentGateway` on top of Mercado Pago Checkout Pro and its payments API. */
@Injectable()
export class MercadoPagoGateway implements PaymentGateway {
  private readonly webhookSecret: string
  private readonly notificationUrl: string | null
  /**
   * Prepended to our references (`external_reference`) so databases that share one Mercado Pago account (each
   * developer, staging) never take each other's payments. Empty in production.
   */
  private readonly referencePrefix: string

  constructor(
    private readonly client: MercadoPagoClient,
    config: ConfigService,
  ) {
    this.webhookSecret = config.get<string>('MERCADO_PAGO_WEBHOOK_SECRET') ?? ''
    this.notificationUrl = config.get<string>('MERCADO_PAGO_NOTIFICATION_URL') || null
    this.referencePrefix = (config.get<string>('MERCADO_PAGO_REFERENCE_PREFIX') ?? '')
      .replace(/[^A-Za-z0-9-]/g, '')
      .slice(0, 20)
  }

  get configured(): boolean {
    return this.client.hasCredentials
  }

  async createCheckout(request: CheckoutRequest): Promise<string> {
    const body = preferenceBody(request, {
      externalReference: `${this.referencePrefix}${request.reference}`,
      notificationUrl: this.notificationUrl,
    })
    const preference = await this.client.request<MercadoPagoPreference>('POST', '/checkout/preferences', body)
    const url = this.client.usesTestToken ? preference.sandbox_init_point : preference.init_point
    if (!url?.startsWith('https://')) throw new PaymentGatewayError('UNAVAILABLE', 'Preference without checkout URL')
    return url
  }

  async getPayment(id: string): Promise<GatewayPayment> {
    if (!/^\d{1,20}$/.test(id)) throw new PaymentGatewayError('NOT_FOUND', 'Invalid Mercado Pago payment id')
    const payment = gatewayPayment(
      await this.client.request<MercadoPagoPayment>('GET', `/v1/payments/${id}`),
      this.referencePrefix,
    )
    if (!payment) throw new PaymentGatewayError('UNAVAILABLE', 'Unexpected Mercado Pago payment')
    return payment
  }

  async findPayments(reference: string): Promise<GatewayPayment[]> {
    const query = new URLSearchParams({
      external_reference: `${this.referencePrefix}${reference}`,
      sort: 'date_created',
      criteria: 'desc',
      limit: '30',
    })
    const search = await this.client.request<MercadoPagoPaymentSearch>('GET', `/v1/payments/search?${query}`)
    return (search.results ?? [])
      .map(payment => gatewayPayment(payment, this.referencePrefix))
      .filter((payment): payment is GatewayPayment => payment?.reference === reference)
  }

  /** Only signed `payment` notifications count; the id is signed in the query string (`data.id`). */
  readNotification(request: GatewayWebhookRequest): GatewayNotification {
    const query = new URLSearchParams(request.query)
    const body = (request.body ?? {}) as { id?: unknown; type?: unknown; data?: { id?: unknown } }
    const dataId = query.get('data.id') ?? idText(body.data?.id)
    if (!validSignature(this.webhookSecret, request.signature, request.requestId, dataId)) return 'UNAUTHORIZED'
    const topic = query.get('type') ?? (typeof body.type === 'string' ? body.type : '')
    const notificationId = idText(body.id) ?? request.requestId
    if (topic !== 'payment' || !dataId || !/^\d{1,20}$/.test(dataId) || !notificationId) return 'IGNORED'
    return { notificationId: notificationId.slice(0, 100), topic, paymentId: dataId }
  }
}
