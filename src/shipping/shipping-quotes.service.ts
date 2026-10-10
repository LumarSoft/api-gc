import { Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { Currency } from '../generated/prisma/enums'
import type { MoneyDto } from '../pricing/pricing.service'
import { PrismaService } from '../prisma/prisma.service'
import type { ShippingQuoteOptionDto, ShippingQuotesResponseDto } from './dto/shipping-quote-response.dto'
import {
  QUOTE_TTL_MINUTES,
  SHIPPABILITY_MESSAGES,
  carrierItems,
  itemsHash,
  sameDestination,
  shippabilityIssue,
  type ShippableLine,
  type ShippableVariant,
} from './lib/shipping-rules'
import { CarrierError, SHIPPING_CARRIER, type CarrierDestination, type ShippingCarrier } from './shipping-carrier'

export interface CarrierAvailability {
  enabled: boolean
  reason: string | null
}

const UNAVAILABLE = 'El envío al resto del país todavía no está disponible.'

const variantSelect = {
  id: true,
  sku: true,
  weightGrams: true,
  lengthMm: true,
  widthMm: true,
  heightMm: true,
} satisfies Prisma.ProductVariantSelect

const selectedQuoteSelect = {
  id: true,
  postalCode: true,
  city: true,
  province: true,
  itemsHash: true,
  expiresAt: true,
  carrierId: true,
  carrier: true,
  serviceType: true,
  logisticType: true,
  service: true,
  pickupPointId: true,
  pickupPoint: true,
  amount: true,
  cost: true,
  currency: true,
  minDays: true,
  maxDays: true,
} satisfies Prisma.ShippingQuoteSelect

/** The quote a buyer chose, checked against their cart and address. */
export type SelectedQuote = Prisma.ShippingQuoteGetPayload<{ select: typeof selectedQuoteSelect }>

/** Carrier quotes for a cart: whether it can be quoted, quoting a destination, and checking the buyer's choice. */
@Injectable()
export class ShippingQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_CARRIER) private readonly carrier: ShippingCarrier,
  ) {}

  async availability(lines: ShippableLine[]): Promise<CarrierAvailability> {
    if (!this.carrier.configured) return { enabled: false, reason: UNAVAILABLE }
    const issue = shippabilityIssue(lines, await this.variants(this.prisma, lines))
    return issue ? { enabled: false, reason: SHIPPABILITY_MESSAGES[issue] } : { enabled: true, reason: null }
  }

  async quote(
    cartId: number,
    lines: ShippableLine[],
    declaredValue: MoneyDto,
    destination: CarrierDestination,
  ): Promise<ShippingQuotesResponseDto> {
    if (!this.carrier.configured) throw new UnprocessableEntityException(UNAVAILABLE)
    const variants = await this.variants(this.prisma, lines)
    const issue = shippabilityIssue(lines, variants)
    if (issue) throw new UnprocessableEntityException(SHIPPABILITY_MESSAGES[issue])
    let options
    try {
      options = await this.carrier.quote({
        destination,
        items: carrierItems(lines, variants),
        declaredValue: declaredValue.amount,
      })
    } catch (error) {
      if (!(error instanceof CarrierError)) throw error
      if (error.kind === 'REJECTED')
        throw new UnprocessableEntityException(
          'No pudimos cotizar el envío a esa dirección. Revisá el código postal, la localidad y la provincia.',
        )
      throw new ServiceUnavailableException(
        'No pudimos cotizar el envío en este momento. Probá de nuevo en unos minutos.',
      )
    }
    if (!options.length) throw new UnprocessableEntityException('No encontramos envíos disponibles para esa dirección.')
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000)
    const base = {
      cartId,
      itemsHash: itemsHash(lines),
      postalCode: destination.postalCode,
      city: destination.city,
      province: destination.province,
      currency: Currency.ARS,
      expiresAt,
    }
    // A branch-delivery option becomes one row per branch, so the buyer's choice is a single id.
    const rows = options.flatMap(option => {
      const common = {
        ...base,
        carrierId: option.carrierId,
        carrier: option.carrier.slice(0, 60),
        serviceType: option.serviceType.slice(0, 40),
        logisticType: option.logisticType.slice(0, 40),
        service: option.service.slice(0, 100),
        amount: option.price,
        cost: option.cost,
        minDays: option.minDays,
        maxDays: option.maxDays,
      }
      return option.pickupPoints.length
        ? option.pickupPoints.map(point => ({ ...common, pickupPointId: point.id, pickupPoint: point.description }))
        : [common]
    })
    const saved = await this.prisma.$transaction(
      rows.map(data => this.prisma.shippingQuote.create({ data, select: selectedQuoteSelect })),
    )
    return { options: saved.map(row => this.option(row)), expiresAt: expiresAt.toISOString() }
  }

  /** Runs inside the caller's transaction when placing an order, so the quote read is part of it. */
  async selected(
    db: Prisma.TransactionClient,
    quoteId: number,
    cartId: number,
    lines: ShippableLine[],
    destination: CarrierDestination,
  ): Promise<SelectedQuote> {
    if (!this.carrier.configured) throw new UnprocessableEntityException(UNAVAILABLE)
    const quote = await db.shippingQuote.findFirst({ where: { id: quoteId, cartId }, select: selectedQuoteSelect })
    if (!quote) throw new UnprocessableEntityException('Elegí una opción de envío.')
    if (quote.expiresAt <= new Date() || quote.itemsHash !== itemsHash(lines))
      throw new UnprocessableEntityException('La cotización del envío venció o tu carrito cambió. Cotizá de nuevo.')
    if (!sameDestination(quote, destination))
      throw new UnprocessableEntityException('Cambiaste la dirección de envío. Cotizá de nuevo.')
    const issue = shippabilityIssue(lines, await this.variants(db, lines))
    if (issue) throw new UnprocessableEntityException(SHIPPABILITY_MESSAGES[issue])
    return quote
  }

  option(row: SelectedQuote): ShippingQuoteOptionDto {
    return {
      id: row.id,
      kind: row.pickupPointId ? 'PICKUP_POINT' : 'HOME',
      carrier: row.carrier,
      service: row.service,
      cost: { amount: row.amount.toFixed(2), currency: row.currency },
      minDays: row.minDays,
      maxDays: row.maxDays,
      pickupPoint: row.pickupPoint,
    }
  }

  private async variants(db: Prisma.TransactionClient, lines: ShippableLine[]): Promise<ShippableVariant[]> {
    return db.productVariant.findMany({
      where: { id: { in: lines.map(line => line.variantId) } },
      select: variantSelect,
    })
  }
}
