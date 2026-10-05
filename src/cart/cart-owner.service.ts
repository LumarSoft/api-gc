import { Injectable } from '@nestjs/common'
import { generateSecureToken, hashToken } from '../common/utils/secure-token'
import { Prisma } from '../generated/prisma/client'
import { CartStatus } from '../generated/prisma/enums'
import { mergedQuantity } from './lib/cart-rules'

export interface CartOwner {
  cartId: number | null
  /** Only returned for a newly created guest cart; never stored in plain text. */
  newGuestToken?: string
  clearGuestCookie: boolean
}

const active = { status: CartStatus.ACTIVE, deletedAt: null }

/** Resolves only the current user's cart or an unclaimed guest cart. Caller holds one transaction throughout. */
@Injectable()
export class CartOwnerService {
  async resolve(
    tx: Prisma.TransactionClient,
    userId: number | undefined,
    token: string | undefined,
    create: boolean,
  ): Promise<CartOwner> {
    // Lock the owner before finding/creating a cart: even two first requests cannot create two active user carts.
    if (userId) await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`
    const guest = await this.guest(tx, token)
    if (!userId) {
      if (guest) return { cartId: guest.id, clearGuestCookie: false }
      if (!create) return { cartId: null, clearGuestCookie: Boolean(token) }
      const newGuestToken = generateSecureToken()
      const cart = await tx.cart.create({ data: { guestToken: hashToken(newGuestToken) }, select: { id: true } })
      return { cartId: cart.id, newGuestToken, clearGuestCookie: false }
    }

    const owned = await tx.cart.findFirst({
      where: { ...active, userId },
      orderBy: { id: 'desc' },
      select: { id: true },
    })
    if (owned) {
      await tx.$queryRaw`SELECT id FROM Cart WHERE id = ${owned.id} FOR UPDATE`
      if (guest) await this.merge(tx, owned.id, guest.id)
      return { cartId: owned.id, clearGuestCookie: Boolean(token) }
    }
    if (guest) {
      await tx.cart.update({ where: { id: guest.id }, data: { userId, guestToken: null, lastActivityAt: new Date() } })
      return { cartId: guest.id, clearGuestCookie: true }
    }
    const cart = create ? await tx.cart.create({ data: { userId }, select: { id: true } }) : null
    return { cartId: cart?.id ?? null, clearGuestCookie: Boolean(token) }
  }

  private async guest(tx: Prisma.TransactionClient, token: string | undefined): Promise<{ id: number } | null> {
    if (!token) return null
    const where = { ...active, userId: null, guestToken: hashToken(token) }
    const cart = await tx.cart.findFirst({ where, select: { id: true } })
    if (!cart) return null
    await tx.$queryRaw`SELECT id FROM Cart WHERE id = ${cart.id} FOR UPDATE`
    // A login may have claimed the cart while this request was waiting for its lock.
    return tx.cart.findFirst({ where: { ...where, id: cart.id }, select: { id: true } })
  }

  private async merge(tx: Prisma.TransactionClient, targetId: number, guestId: number): Promise<void> {
    const incoming = await tx.cartItem.findMany({
      where: { cartId: guestId, deletedAt: null },
      select: { variantId: true, quantity: true },
    })
    for (const item of incoming) {
      const current = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: targetId, variantId: item.variantId } },
        select: { quantity: true, deletedAt: true },
      })
      const quantity = mergedQuantity(current && !current.deletedAt ? current.quantity : 0, item.quantity)
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: targetId, variantId: item.variantId } },
        create: { cartId: targetId, variantId: item.variantId, quantity },
        update: { quantity, deletedAt: null },
      })
    }
    const now = new Date()
    await tx.cartItem.updateMany({ where: { cartId: guestId, deletedAt: null }, data: { deletedAt: now } })
    await tx.cart.update({ where: { id: guestId }, data: { deletedAt: now, guestToken: null } })
    await tx.cart.update({ where: { id: targetId }, data: { lastActivityAt: now } })
  }
}
