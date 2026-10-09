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
import { ZipnovaClient } from './zipnova.client'

/** `ShippingCarrier` on top of Zipnova, which quotes and books Correo Argentino, OCA and other carriers. */
@Injectable()
export class ZipnovaCarrier implements ShippingCarrier {
  private readonly accountId: number
  private readonly originId: number
  private readonly webhookSecret: string

  constructor(
    private readonly client: ZipnovaClient,
    config: ConfigService,
  ) {
    this.accountId = Number(config.get<string>('ZIPNOVA_ACCOUNT_ID'))
    this.originId = Number(config.get<string>('ZIPNOVA_ORIGIN_ID'))
    this.webhookSecret = config.get<string>('ZIPNOVA_WEBHOOK_SECRET') ?? ''
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
      shipmentBody(this.accountId, this.originId, request),
    )
    return carrierShipment(shipment)
  }

  async findShipment(reference: string): Promise<CarrierShipment | null> {
    const query = new URLSearchParams({ account_id: String(this.accountId), external_id: reference })
    const list = await this.client.request<ZipnovaShipmentList>('GET', `/shipments?${query.toString()}`)
    const found = (list.data ?? []).find(shipment => shipment.external_id === reference)
    return found ? this.getShipment(String(found.id)) : null
  }

  async getShipment(id: string): Promise<CarrierShipment> {
    return carrierShipment(await this.client.request<ZipnovaShipment>('GET', `/shipments/${this.id(id)}`))
  }

  async cancelShipment(id: string): Promise<'CANCELLED' | 'RESCUE_REQUESTED'> {
    const result = await this.client.request<{ success?: boolean; result?: string }>(
      'POST',
      `/shipments/${this.id(id)}/cancel`,
    )
    if (result.success === false) throw new CarrierError('REJECTED', 'Zipnova could not cancel the shipment')
    return result.result === 'rescue_requested' ? 'RESCUE_REQUESTED' : 'CANCELLED'
  }

  async document(id: string, kind: CarrierDocumentKind, format: CarrierDocumentFormat): Promise<CarrierDocument> {
    const what = kind === 'guide' ? 'document' : 'label'
    const response = await this.client.request<ZipnovaDocument>('GET', `/shipments/${this.id(id)}/${what}.${format}`)
    // TODO(zipnova): confirm the field that carries the base64 file once the account is in test mode; the docs only
    // say "documento en base64 con formato y contenido".
    const base64 = response.content ?? response.data ?? response.file
    if (!base64) throw new CarrierError('NOT_READY', 'Zipnova returned no document')
    return {
      content: Buffer.from(base64, 'base64'),
      contentType: format === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8',
      fileName: `${kind === 'guide' ? 'guia' : 'etiqueta'}-${id}.${format}`,
    }
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

  /** Our stored ids are Zipnova's numeric ids; anything else must never reach the URL. */
  private id(value: string): number {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0) throw new CarrierError('NOT_FOUND', 'Invalid Zipnova shipment id')
    return id
  }
}
