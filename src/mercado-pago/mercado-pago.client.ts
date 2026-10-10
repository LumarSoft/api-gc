import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentGatewayError } from './payment-gateway'

const DEFAULT_URL = 'https://api.mercadopago.com'
const TIMEOUT_MS = 10_000

/** HTTP access to the Mercado Pago API with the seller's access token. Knows nothing about orders. */
@Injectable()
export class MercadoPagoClient {
  private readonly logger = new Logger(MercadoPagoClient.name)
  private readonly baseUrl: string
  private readonly accessToken: string

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('MERCADO_PAGO_API_URL') || DEFAULT_URL).replace(/\/+$/, '')
    this.accessToken = config.get<string>('MERCADO_PAGO_ACCESS_TOKEN') ?? ''
  }

  get hasCredentials(): boolean {
    return this.accessToken.length > 0
  }

  /** Test credentials of the developer's own account (`TEST-…`) pay through the sandbox checkout URL. */
  get usesTestToken(): boolean {
    return this.accessToken.startsWith('TEST-')
  }

  /** A JSON object answer. Anything else on a 2xx is treated as the provider being unavailable. */
  async request<T extends object>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    if (!this.hasCredentials) throw new PaymentGatewayError('UNAVAILABLE', 'Mercado Pago is not configured')
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown'
      this.logger.error(`Mercado Pago ${method} ${this.route(path)} failed before answering (${reason})`)
      throw new PaymentGatewayError('UNAVAILABLE', 'Mercado Pago did not answer')
    }
    const payload: unknown = await response.json().catch(() => null)
    if (response.ok && payload && typeof payload === 'object') return payload as T
    // Only the status and Mercado Pago's own message: request bodies carry the buyer's personal data.
    const message = this.message(payload)
    this.logger.warn(
      `Mercado Pago ${method} ${this.route(path)} answered ${response.status}${message ? `: ${message}` : ''}`,
    )
    if (response.status === 404) throw new PaymentGatewayError('NOT_FOUND', 'Not found at Mercado Pago', 404)
    if (response.status === 400 || response.status === 422)
      throw new PaymentGatewayError('REJECTED', message ?? 'Rejected by Mercado Pago', response.status)
    throw new PaymentGatewayError('UNAVAILABLE', `Mercado Pago answered ${response.status}`, response.status)
  }

  /** The path without ids or query, so logs group by endpoint and never carry references. */
  private route(path: string): string {
    return path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id')
  }

  private message(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const value = (payload as { message?: unknown }).message
    return typeof value === 'string' && value ? value.slice(0, 200) : null
  }
}
