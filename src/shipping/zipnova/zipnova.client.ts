import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CarrierError } from '../shipping-carrier'

const DEFAULT_URL = 'https://api.zipnova.com.ar/v2'
const TIMEOUT_MS = 10_000

/** HTTP access to Zipnova API v2 with basic auth (one account). Knows nothing about orders or carts. */
@Injectable()
export class ZipnovaClient {
  private readonly logger = new Logger(ZipnovaClient.name)
  private readonly baseUrl: string
  private readonly authorization: string | null

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('ZIPNOVA_API_URL') || DEFAULT_URL).replace(/\/+$/, '')
    const key = config.get<string>('ZIPNOVA_API_KEY')
    const secret = config.get<string>('ZIPNOVA_API_SECRET')
    this.authorization = key && secret ? `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` : null
  }

  get hasCredentials(): boolean {
    return this.authorization !== null
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    if (!this.authorization) throw new CarrierError('UNAVAILABLE', 'Zipnova credentials are not configured')
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.authorization,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown'
      this.logger.error(`Zipnova ${method} ${this.route(path)} failed before answering (${reason})`)
      throw new CarrierError('UNAVAILABLE', 'Zipnova did not answer')
    }
    const payload: unknown = await response.json().catch(() => null)
    if (response.ok) return payload as T
    // Only the status and Zipnova's own message: request bodies carry the buyer's personal data.
    const message = this.message(payload)
    this.logger.warn(
      `Zipnova ${method} ${this.route(path)} answered ${response.status}${message ? `: ${message}` : ''}`,
    )
    if (response.status === 404) throw new CarrierError('NOT_FOUND', 'Not found at Zipnova')
    if (response.status === 409) throw new CarrierError('NOT_READY', 'Zipnova has not generated it yet')
    if ([400, 406, 422].includes(response.status)) throw new CarrierError('REJECTED', message ?? 'Rejected by Zipnova')
    throw new CarrierError('UNAVAILABLE', `Zipnova answered ${response.status}`)
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
