import { timingSafeEqual } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  CarrierError,
  type CarrierDocument,
  type CarrierDocumentFormat,
  type CarrierDocumentKind,
  type CarrierNotification,
  type CarrierQuoteOption,
  type CarrierQuoteRequest,
  type CarrierShipment,
  type CarrierShipmentRequest,
  type ShippingCarrier,
} from '../shipping-carrier'
import { carrierShipment, quoteBody, quoteOptions, shipmentBody } from './zipnova-mappers'
import type { ZipnovaDocument, ZipnovaQuoteResponse, ZipnovaShipment, ZipnovaShipmentList } from './zipnova-types'
import { ZipnovaClient, type ZipnovaDownload } from './zipnova.client'

/** Booking can take Zipnova a while (it quotes again and asks the carrier for a tracking number). */
const BOOKING_TIMEOUT_MS = 20_000

/** `ShippingCarrier` on top of Zipnova, which quotes and books Correo Argentino, OCA and other carriers. */
@Injectable()
export class ZipnovaCarrier implements ShippingCarrier {
  private readonly accountId: number
  private readonly originId: number
  private readonly webhookSecret: string
  /**
   * Prepended to our references (Zipnova `external_id`, max 30 characters) so databases that share one Zipnova
   * account (two developers, staging) never find each other's shipments. Empty in production.
   */
  private readonly referencePrefix: string

  constructor(
    private readonly client: ZipnovaClient,
    config: ConfigService,
  ) {
    this.accountId = Number(config.get<string>('ZIPNOVA_ACCOUNT_ID'))
    this.originId = Number(config.get<string>('ZIPNOVA_ORIGIN_ID'))
    this.webhookSecret = config.get<string>('ZIPNOVA_WEBHOOK_SECRET') ?? ''
    this.referencePrefix = (config.get<string>('ZIPNOVA_REFERENCE_PREFIX') ?? '')
      .replace(/[^A-Za-z0-9-]/g, '')
      .slice(0, 12)
  }

  get configured(): boolean {
    return this.client.hasCredentials && this.accountId > 0 && this.originId > 0
  }

  async quote(request: CarrierQuoteRequest): Promise<CarrierQuoteOption[]> {
    const response = await this.client.request<ZipnovaQuoteResponse>(
      'POST',
      '/shipments/quote',
      quoteBody(this.accountId, this.originId, request),
    )
    return quoteOptions(response)
  }

  async createShipment(request: CarrierShipmentRequest): Promise<CarrierShipment> {
    const shipment = await this.client.request<ZipnovaShipment>(
      'POST',
      '/shipments',
      shipmentBody(this.accountId, this.originId, { ...request, reference: this.reference(request.reference) }),
      BOOKING_TIMEOUT_MS,
    )
    return carrierShipment(shipment)
  }

  /** Cancelled shipments are skipped: a reference is only reused to recover a live booking. */
  async findShipment(reference: string): Promise<CarrierShipment | null> {
    const externalId = this.reference(reference)
    const query = new URLSearchParams({ account_id: String(this.accountId), external_id: externalId })
    const list = await this.client.request<ZipnovaShipmentList>('GET', `/shipments?${query.toString()}`)
    const found = (list.data ?? []).find(
      shipment => shipment.external_id === externalId && !['cancelled', 'expired'].includes(shipment.status),
    )
    return found ? this.getShipment(String(found.id)) : null
  }

  async getShipment(id: string): Promise<CarrierShipment> {
    return carrierShipment(await this.client.request<ZipnovaShipment>('GET', `/shipments/${this.id(id)}`))
  }

  async cancelShipment(id: string): Promise<'CANCELLED' | 'RESCUE_REQUESTED'> {
    let result: { success?: boolean; result?: string }
    try {
      result = await this.client.request('POST', `/shipments/${this.id(id)}/cancel`)
    } catch (error) {
      // On this endpoint 401 means "not cancellable in its current state", not a credentials problem.
      if (error instanceof CarrierError && error.status === 401)
        throw new CarrierError('REJECTED', 'el envío ya no se puede cancelar en su estado actual', 401)
      throw error
    }
    if (result.success === false) throw new CarrierError('REJECTED', 'Zipnova could not cancel the shipment')
    return result.result === 'rescue_requested' ? 'RESCUE_REQUESTED' : 'CANCELLED'
  }

  async document(id: string, kind: CarrierDocumentKind, format: CarrierDocumentFormat): Promise<CarrierDocument> {
    const what = kind === 'guide' ? 'document' : 'label'
    let download: ZipnovaDownload
    try {
      download = await this.client.download(`/shipments/${this.id(id)}/${what}.${format}`)
    } catch (error) {
      // Zipnova answers 400 when the carrier works without a dispatch guide (e.g. OCA home delivery).
      if (
        kind === 'guide' &&
        error instanceof CarrierError &&
        error.kind === 'REJECTED' &&
        /guide/i.test(error.message)
      )
        throw new CarrierError('REJECTED', 'este transporte no usa guía de despacho; alcanza con la etiqueta', 400)
      throw error
    }
    const content = 'bytes' in download ? download.bytes : this.decode((download.json as ZipnovaDocument).body)
    if (!content?.length) throw new CarrierError('NOT_READY', 'Zipnova returned no document')
    return {
      content,
      contentType: format === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8',
      fileName: `${kind === 'guide' ? 'guia' : 'etiqueta'}-${id}.${format}`,
    }
  }

  /** The documented answer is base64; a file sent as plain text (ZPL or PDF) is kept as is. */
  private decode(body: string | null | undefined): Buffer | null {
    if (typeof body !== 'string' || !body) return null
    if (body.startsWith('^XA') || body.startsWith('%PDF')) return Buffer.from(body, 'latin1')
    return Buffer.from(body.replace(/^data:[^,]*,/, ''), 'base64')
  }

  /**
   * Zipnova does not sign webhooks, so the URL carries a secret and the body is only a hint: the caller fetches the
   * shipment from the API before changing anything.
   */
  readNotification(token: string, body: unknown): CarrierNotification {
    const expected = Buffer.from(this.webhookSecret)
    const given = Buffer.from(token)
    if (expected.length < 32 || given.length !== expected.length || !timingSafeEqual(given, expected))
      return 'UNAUTHORIZED'
    const data = (body as { topic?: unknown; data?: { shipment_id?: unknown } } | null) ?? {}
    const shipmentId = data.data?.shipment_id
    if (!['status', 'shipment'].includes(String(data.topic)) || !Number.isInteger(shipmentId)) return 'IGNORED'
    return { shipmentId: String(shipmentId) }
  }

  async availableCredit(): Promise<number | null> {
    const billing = await this.client.request<{ available?: unknown }>('GET', `/accounts/${this.accountId}/billing`)
    return typeof billing.available === 'number' ? billing.available : null
  }

  private reference(reference: string): string {
    return `${this.referencePrefix}${reference}`.slice(0, 30)
  }

  /** Our stored ids are Zipnova's numeric ids; anything else must never reach the URL. */
  private id(value: string): number {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0) throw new CarrierError('NOT_FOUND', 'Invalid Zipnova shipment id')
    return id
  }
}
