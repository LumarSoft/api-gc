import { reservationHours } from './lib/reservation-hours'
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { CartOwnerService } from '../cart/cart-owner.service'
import { CartMapper } from '../cart/cart.mapper'
import { cartVariantSelect } from '../cart/lib/cart-selects'
import { checkoutDeliveryOptions, checkoutTotal, isRosarioAddress } from '../checkout/lib/checkout-delivery'
import { checkoutReview } from '../checkout/lib/checkout-review'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { hashToken } from '../common/utils/secure-token'
import { Prisma } from '../generated/prisma/client'
import { AddressType, BuyerType, CartStatus, Currency, DeliveryMethod, PaymentMethod } from '../generated/prisma/enums'
import { PricingService } from '../pricing/pricing.service'
import { PrismaService } from '../prisma/prisma.service'
import type { PlaceOrderDto } from './dto/order-input.dto'
import type { OrderResponseDto } from './dto/order-response.dto'
import { orderSelect } from './lib/order-selects'
import { OrderMapper } from './order.mapper'
import { OrderStockService } from './order-stock.service'

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly owners: CartOwnerService,
    private readonly cartMapper: CartMapper,
    private readonly pricing: PricingService,
    private readonly mapper: OrderMapper,
    private readonly stock: OrderStockService,
  ) {}

  async place(
    user: AuthenticatedUser | undefined,
    cartToken: string | undefined,
    input: PlaceOrderDto,
  ): Promise<OrderResponseDto> {
    const accessTokenHash = hashToken(input.accessToken)
    const context = await this.pricing.getContext(user)
    return this.prisma.$transaction(
      async tx => {
        const previous = await tx.order.findUnique({ where: { accessTokenHash }, select: orderSelect })
        if (previous) return this.mapper.response(previous)
        const owner = await this.owners.resolve(tx, user?.id, cartToken, false)
        // Recheck after acquiring the cart lock: a retry may have waited for the first confirmation to finish.
        const retry = await tx.order.findUnique({ where: { accessTokenHash }, select: orderSelect })
        if (retry) return this.mapper.response(retry)
        if (!owner.cartId) throw new UnprocessableEntityException('Tu carrito está vacío.')
        const lines = await tx.cartItem.findMany({
          where: { cartId: owner.cartId, deletedAt: null },
          orderBy: { id: 'asc' },
          select: { variantId: true, quantity: true },
        })
        if (!lines.length) throw new UnprocessableEntityException('Tu carrito está vacío.')
        await this.stock.lock(
          tx,
          lines.map(line => line.variantId),
        )
        const rows = await tx.cartItem.findMany({
          where: { cartId: owner.cartId, deletedAt: null },
          orderBy: { id: 'asc' },
          select: { quantity: true, variant: { select: cartVariantSelect(context.priceListIds) } },
        })
        const cart = this.cartMapper.response(rows.map(row => this.cartMapper.item(row.variant, row.quantity, context)))
        if (cart.hasIssues || !cart.subtotal)
          throw new UnprocessableEntityException('El precio o el stock cambió. Revisá tu carrito.')
        const local = await tx.shippingMethod.findFirst({
          where: { code: DeliveryMethod.LOCAL_DELIVERY, deletedAt: null },
        })
        const selected = checkoutDeliveryOptions(local ? [local] : [], cart.subtotal).find(
          option => option.code === input.deliveryMethod,
        )!
        if (!selected.enabled || !selected.cost)
          throw new UnprocessableEntityException(selected.unavailableReason ?? 'La entrega no está disponible.')
        if (
          input.deliveryMethod === DeliveryMethod.LOCAL_DELIVERY &&
          (!input.shippingAddress || !isRosarioAddress(input.shippingAddress.city, input.shippingAddress.province))
        )
          throw new UnprocessableEntityException('La entrega local requiere una dirección en Rosario, Santa Fe.')
        if (checkoutReview(cart, input, selected.cost) !== input.reviewToken)
          throw new ConflictException('Tu compra cambió desde la revisión. Revisá los datos y el total de nuevo.')
        const total = checkoutTotal(cart.subtotal, selected.cost)!
        if (new Prisma.Decimal(total.amount).gte('10000000000'))
          throw new UnprocessableEntityException('El monto supera la capacidad del pedido online. Contactá al local.')
        const setting = await tx.setting.findUnique({
          where: { key: 'reservation.manualHours' },
          select: { value: true, deletedAt: true },
        })
        const hours = reservationHours(setting)
        const expiresAt = new Date(Date.now() + hours * 3_600_000)
        const order = await tx.order.create({
          data: {
            number: `TMP-${input.accessToken.slice(0, 16)}`,
            accessTokenHash,
            userId: user?.id,
            buyerType: user?.buyerType ?? BuyerType.RETAIL,
            companyId: user?.buyerType === BuyerType.WHOLESALE ? user.companyId : null,
            priceListId: context.priceListIds[0],
            paymentMethod: PaymentMethod.MANUAL,
            deliveryMethod: input.deliveryMethod,
            exchangeRate: rows.some(
              row =>
                context.priceListIds.map(id => row.variant.prices.find(price => price.priceListId === id)).find(Boolean)
                  ?.currency === Currency.USD,
            )
              ? context.usdRate
              : null,
            subtotal: cart.subtotal.amount,
            shippingTotal: selected.cost.amount,
            total: total.amount,
            contactEmail: input.email,
            contactPhone: input.phone || null,
            expiresAt,
            items: {
              create: rows.map((row, index) => {
                const listed = context.priceListIds
                  .map(id => row.variant.prices.find(price => price.priceListId === id))
                  .find(Boolean)!
                return {
                  variantId: row.variant.id,
                  productName: row.variant.product.name,
                  variantName: row.variant.name,
                  sku: row.variant.sku,
                  quantity: row.quantity,
                  unitPrice: cart.items[index].unitPrice!.amount,
                  lineTotal: cart.items[index].total!.amount,
                  listUnitPrice: listed.amount,
                  listCurrency: listed.currency,
                }
              }),
            },
            addresses: {
              create: [
                { type: AddressType.BILLING, name: input.name, phone: input.phone || null },
                ...(input.deliveryMethod === DeliveryMethod.LOCAL_DELIVERY
                  ? [
                      {
                        type: AddressType.SHIPPING,
                        name: input.name,
                        phone: input.phone || null,
                        ...input.shippingAddress!,
                      },
                    ]
                  : []),
              ],
            },
            statusHistory: { create: { toStatus: 'PENDING_PAYMENT' } },
          },
          select: { id: true },
        })
        await this.stock.reserve(tx, order.id, lines, expiresAt)
        await tx.cart.update({
          where: { id: owner.cartId },
          data: { status: CartStatus.CONVERTED, orderId: order.id, guestToken: null },
        })
        const saved = await tx.order.update({
          where: { id: order.id },
          data: { number: `CG-${String(order.id).padStart(6, '0')}` },
          select: orderSelect,
        })
        return this.mapper.response(saved)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 },
    )
  }

  async track(number: string, accessToken: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { number, accessTokenHash: hashToken(accessToken) },
      select: orderSelect,
    })
    if (!order) throw new NotFoundException('No encontramos un pedido con este enlace privado.')
    return this.mapper.response(order)
  }

  async recover(accessToken: string): Promise<OrderResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      select: orderSelect,
    })
    if (!order) throw new NotFoundException('Todavía no encontramos una confirmación para este intento.')
    return this.mapper.response(order)
  }
}
