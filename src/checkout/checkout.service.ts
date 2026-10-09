import { reservationHours } from '../orders/lib/reservation-hours'
import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { CartService } from '../cart/cart.service'
import type { CartOwner } from '../cart/cart-owner.service'
import type { CartResponseDto } from '../cart/dto/cart-response.dto'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { Currency, DeliveryMethod } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ShippingQuotesResponseDto } from '../shipping/dto/shipping-quote-response.dto'
import type { ShippableLine } from '../shipping/lib/shipping-rules'
import { ShippingQuotesService } from '../shipping/shipping-quotes.service'
import type { PreviewCheckoutDto, QuoteShippingDto } from './dto/checkout-input.dto'
import type { CheckoutResponseDto } from './dto/checkout-response.dto'
import { checkoutDeliveryOptions, checkoutTotal, deliveryInputError } from './lib/checkout-delivery'
import { checkoutReview } from './lib/checkout-review'

export interface CheckoutResult extends CartOwner {
  checkout: CheckoutResponseDto
}

export interface ShippingQuotesResult extends CartOwner {
  quotes: ShippingQuotesResponseDto
}

const lines = (cart: CartResponseDto): ShippableLine[] =>
  cart.items.map(item => ({ variantId: item.variantId, quantity: item.quantity }))

@Injectable()
export class CheckoutService {
  constructor(
    private readonly carts: CartService,
    private readonly prisma: PrismaService,
    private readonly quotes: ShippingQuotesService,
  ) {}

  async preview(
    user: AuthenticatedUser | undefined,
    token: string | undefined,
    input?: PreviewCheckoutDto,
  ): Promise<CheckoutResult> {
    const [result, methods, reservation] = await Promise.all([
      this.carts.read(user, token),
      this.prisma.shippingMethod.findFirst({
        where: { code: DeliveryMethod.LOCAL_DELIVERY, deletedAt: null },
        select: {
          code: true,
          name: true,
          description: true,
          isActive: true,
          currency: true,
          flatRate: true,
          freeShippingThreshold: true,
        },
      }),
      this.prisma.setting.findUnique({
        where: { key: 'reservation.manualHours' },
        select: { value: true, deletedAt: true },
      }),
    ])
    const { cart, ...owner } = result
    const config = methods ? [methods] : []
    const carrier = await this.quotes.availability(lines(cart))
    const deliveryMethod = input?.deliveryMethod ?? DeliveryMethod.STORE_PICKUP
    if (input) {
      if (!cart.items.length)
        throw new UnprocessableEntityException('Tu carrito está vacío. Agregá productos antes de continuar.')
      if (cart.hasIssues || !cart.subtotal)
        throw new UnprocessableEntityException('Revisá el precio y el stock de los productos antes de continuar.')
      const option = checkoutDeliveryOptions(config, cart.subtotal, { ...carrier, cost: null }).find(
        candidate => candidate.code === deliveryMethod,
      )!
      if (!option.enabled) throw new UnprocessableEntityException(option.unavailableReason!)
      const error = deliveryInputError(input)
      if (error) throw new UnprocessableEntityException(error)
    }
    const quote =
      input?.deliveryMethod === DeliveryMethod.CARRIER
        ? await this.quotes.selected(
            this.prisma,
            input.shippingQuoteId!,
            owner.cartId!,
            lines(cart),
            input.shippingAddress!,
          )
        : null
    const deliveryOptions = checkoutDeliveryOptions(config, cart.subtotal, {
      ...carrier,
      cost: quote ? { amount: quote.amount.toFixed(2), currency: Currency.ARS } : null,
    })
    const selected = deliveryOptions.find(option => option.code === deliveryMethod)!
    return {
      ...owner,
      checkout: {
        cart,
        deliveryOptions,
        deliveryMethod,
        shippingTotal: selected.cost,
        total: checkoutTotal(cart.subtotal, selected.cost),
        customer: input ? { name: input.name, email: input.email, phone: input.phone || null } : null,
        shippingAddress: deliveryMethod !== DeliveryMethod.STORE_PICKUP ? (input?.shippingAddress ?? null) : null,
        shippingQuote: quote ? this.quotes.option(quote) : null,
        canReview: Boolean(cart.items.length && !cart.hasIssues && cart.subtotal && selected.enabled),
        reviewToken: input && selected.cost ? checkoutReview(cart, input, selected.cost) : null,
        reservationHours: reservationHours(reservation),
      },
    }
  }

  async quoteShipping(
    user: AuthenticatedUser | undefined,
    token: string | undefined,
    input: QuoteShippingDto,
  ): Promise<ShippingQuotesResult> {
    const { cart, ...owner } = await this.carts.read(user, token)
    if (!cart.items.length || !owner.cartId)
      throw new UnprocessableEntityException('Tu carrito está vacío. Agregá productos antes de continuar.')
    if (cart.hasIssues || !cart.subtotal)
      throw new UnprocessableEntityException('Revisá el precio y el stock de los productos antes de continuar.')
    return { ...owner, quotes: await this.quotes.quote(owner.cartId, lines(cart), cart.subtotal, input.destination) }
  }
}
