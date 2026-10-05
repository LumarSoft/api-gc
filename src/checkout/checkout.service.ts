import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { CartService } from '../cart/cart.service'
import type { CartOwner } from '../cart/cart-owner.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { DeliveryMethod } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { PreviewCheckoutDto } from './dto/checkout-input.dto'
import type { CheckoutResponseDto } from './dto/checkout-response.dto'
import { checkoutDeliveryOptions, checkoutTotal, isRosarioAddress } from './lib/checkout-delivery'

export interface CheckoutResult extends CartOwner {
  checkout: CheckoutResponseDto
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly carts: CartService,
    private readonly prisma: PrismaService,
  ) {}

  async preview(
    user: AuthenticatedUser | undefined,
    token: string | undefined,
    input?: PreviewCheckoutDto,
  ): Promise<CheckoutResult> {
    const [result, methods] = await Promise.all([
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
    ])
    const { cart, ...owner } = result
    const deliveryOptions = checkoutDeliveryOptions(methods ? [methods] : [], cart.subtotal)
    const deliveryMethod = input?.deliveryMethod ?? DeliveryMethod.STORE_PICKUP
    const selected = deliveryOptions.find(option => option.code === deliveryMethod)!
    if (input) {
      if (!cart.items.length)
        throw new UnprocessableEntityException('Tu carrito está vacío. Agregá productos antes de continuar.')
      if (cart.hasIssues || !cart.subtotal)
        throw new UnprocessableEntityException('Revisá el precio y el stock de los productos antes de continuar.')
      if (!selected.enabled) throw new UnprocessableEntityException(selected.unavailableReason!)
      if (
        deliveryMethod === DeliveryMethod.LOCAL_DELIVERY &&
        (!input.shippingAddress || !isRosarioAddress(input.shippingAddress.city, input.shippingAddress.province))
      )
        throw new UnprocessableEntityException('La entrega local requiere una dirección en Rosario, Santa Fe.')
    }
    return {
      ...owner,
      checkout: {
        cart,
        deliveryOptions,
        deliveryMethod,
        shippingTotal: selected.cost,
        total: checkoutTotal(cart.subtotal, selected.cost),
        customer: input ? { name: input.name, email: input.email, phone: input.phone || null } : null,
        shippingAddress: deliveryMethod === DeliveryMethod.LOCAL_DELIVERY ? (input?.shippingAddress ?? null) : null,
        canReview: Boolean(cart.items.length && !cart.hasIssues && cart.subtotal && selected.enabled),
      },
    }
  }
}
