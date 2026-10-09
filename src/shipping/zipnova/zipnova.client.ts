import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CarrierError } from '../shipping-carrier'

const DEFAULT_URL = 'https://api.zipnova.com.ar/v2'
const TIMEOUT_MS = 10_000

type Method = 'GET' | 'POST'

/** A downloaded file: Zipnova may answer it as JSON (base64 inside) or as the file itself. */
export type ZipnovaDownload = { json: object } | { bytes: Buffer; contentType: string }

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

  /** A JSON object answer. Anything else on a 2xx is treated as the provider being unavailable. */
  async request<T extends object>(method: Method, path: string, body?: object, timeoutMs = TIMEOUT_MS): Promise<T> {
    const response = await this.send(method, path, body, timeoutMs)
    const payload: unknown = await response.json().catch(() => null)
    if (payload && typeof payload === 'object') return payload as T
    this.logger.error(`Zipnova ${method} ${this.route(path)} answered ${response.status} without a JSON object`)
    throw new CarrierError('UNAVAILABLE', 'Unexpected Zipnova answer')
  }

  async download(path: string): Promise<ZipnovaDownload> {
    const response = await this.send('GET', path, undefined, TIMEOUT_MS)
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
    if (!contentType.includes('json')) return { bytes: Buffer.from(await response.arrayBuffer()), contentType }
    const payload: unknown = await response.json().catch(() => null)
    if (payload && typeof payload === 'object') return { json: payload }
    throw new CarrierError('UNAVAILABLE', 'Unexpected Zipnova answer')
  }

  /** Sends the request and returns a 2xx response; every other outcome becomes a `CarrierError`. */
  private async send(method: Method, path: string, body: object | undefined, timeoutMs: number): Promise<Response> {
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
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown'
      this.logger.error(`Zipnova ${method} ${this.route(path)} failed before answering (${reason})`)
      throw new CarrierError('UNAVAILABLE', 'Zipnova did not answer')
    }
    if (response.ok) return response
    // Only the status and Zipnova's own message: request bodies carry the buyer's personal data.
    const message = this.message(await response.json().catch(() => null))
    this.logger.warn(
      `Zipnova ${method} ${this.route(path)} answered ${response.status}${message ? `: ${message}` : ''}`,
    )
    if (response.status === 404) throw new CarrierError('NOT_FOUND', 'Not found at Zipnova', response.status)
    if (response.status === 409)
      throw new CarrierError('NOT_READY', 'Zipnova has not generated it yet', response.status)
    if ([400, 406, 422].includes(response.status))
      throw new CarrierError('REJECTED', message ?? 'Rejected by Zipnova', response.status)
    throw new CarrierError('UNAVAILABLE', `Zipnova answered ${response.status}`, response.status)
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
