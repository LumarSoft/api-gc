import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { Prisma } from '../generated/prisma/client'
import { PricingService, type PriceContext } from '../pricing/pricing.service'
import { PrismaService } from '../prisma/prisma.service'
import { CartOwnerService, type CartOwner } from './cart-owner.service'
import { CartMapper } from './cart.mapper'
import type { AddCartItemDto, CartQuantityDto } from './dto/cart-input.dto'
import type { CartResponseDto } from './dto/cart-response.dto'
import { MAX_CART_QUANTITY } from './lib/cart-rules'
import { cartVariantSelect } from './lib/cart-selects'

export interface CartResult extends CartOwner {
  cart: CartResponseDto
}
type Change =
  | { type: 'add'; input: AddCartItemDto }
  | { type: 'set'; variantId: number; input: CartQuantityDto }
  | { type: 'remove'; variantId: number }
  | { type: 'clear' }

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly owner: CartOwnerService,
    private readonly mapper: CartMapper,
  ) {}

  read(user: AuthenticatedUser | undefined, token: string | undefined): Promise<CartResult> {
    return this.run(user, token)
  }

  add(user: AuthenticatedUser | undefined, token: string | undefined, input: AddCartItemDto): Promise<CartResult> {
    return this.run(user, token, { type: 'add', input })
  }

  set(
    user: AuthenticatedUser | undefined,
    token: string | undefined,
    variantId: number,
    input: CartQuantityDto,
  ): Promise<CartResult> {
    return this.run(user, token, { type: 'set', variantId, input })
  }

  remove(user: AuthenticatedUser | undefined, token: string | undefined, variantId: number): Promise<CartResult> {
    return this.run(user, token, { type: 'remove', variantId })
  }

  clear(user: AuthenticatedUser | undefined, token: string | undefined): Promise<CartResult> {
    return this.run(user, token, { type: 'clear' })
  }

  private async run(
    user: AuthenticatedUser | undefined,
    token: string | undefined,
    change?: Change,
  ): Promise<CartResult> {
    const context = await this.pricing.getContext(user)
    return this.prisma.$transaction(
      async tx => {
        const owner = await this.owner.resolve(tx, user?.id, token, change?.type === 'add')
        if (change) await this.change(tx, owner.cartId, change, context)
        const items = owner.cartId
          ? await tx.cartItem.findMany({
              where: { cartId: owner.cartId, deletedAt: null },
              orderBy: { id: 'asc' },
              select: { quantity: true, variant: { select: cartVariantSelect(context.priceListIds) } },
            })
          : []
        return {
          ...owner,
          cart: this.mapper.response(items.map(item => this.mapper.item(item.variant, item.quantity, context))),
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }

  private async change(
    tx: Prisma.TransactionClient,
    cartId: number | null,
    change: Change,
    context: PriceContext,
  ): Promise<void> {
    if (change.type === 'clear') {
      if (cartId) await tx.cartItem.updateMany({ where: { cartId, deletedAt: null }, data: { deletedAt: new Date() } })
    } else {
      if (!cartId) throw new NotFoundException('Cart item not found')
      const variantId = change.type === 'add' ? change.input.variantId : change.variantId
      const where = { cartId_variantId: { cartId, variantId } }
      const current = await tx.cartItem.findUnique({ where, select: { quantity: true, deletedAt: true } })
      if (change.type !== 'add' && (!current || current.deletedAt)) throw new NotFoundException('Cart item not found')
      if (change.type === 'remove') {
        await tx.cartItem.update({ where, data: { deletedAt: new Date() } })
      } else {
        const quantity =
          change.type === 'add'
            ? (current && !current.deletedAt ? current.quantity : 0) + change.input.quantity
            : change.input.quantity
        if (quantity > MAX_CART_QUANTITY)
          throw new UnprocessableEntityException('La cantidad supera el límite del carrito.')
        const variant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: cartVariantSelect(context.priceListIds),
        })
        if (!variant) throw new NotFoundException('Product variant not found')
        const item = this.mapper.item(variant, quantity, context)
        // Always permit reducing an existing line, including one whose product or price disappeared.
        // It remains flagged in the response until fixed or removed.
        const reducing = change.type === 'set' && current && quantity < current.quantity
        if (item.issue && !reducing) throw new UnprocessableEntityException(this.issueMessage(item.issue))
        await tx.cartItem.upsert({
          where,
          create: { cartId, variantId, quantity },
          update: { quantity, deletedAt: null },
        })
      }
    }
    if (cartId) await tx.cart.update({ where: { id: cartId }, data: { lastActivityAt: new Date() } })
  }

  private issueMessage(issue: string): string {
    switch (issue) {
      case 'UNAVAILABLE':
        return 'Este producto ya no está disponible.'
      case 'NO_PRICE':
        return 'Este producto no tiene un precio disponible.'
      case 'NO_EXCHANGE_RATE':
        return 'No podemos calcular el precio en pesos. Intentá más tarde.'
      default:
        return 'No hay stock suficiente para esa cantidad. Actualizá el carrito.'
    }
  }
}
