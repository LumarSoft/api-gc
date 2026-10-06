import type { ConfigService } from '@nestjs/config'
import type { CookieOptions, Request, Response } from 'express'
import type { CartOwner } from './cart-owner.service'

export const CART_COOKIE = 'cg_cart'

export function readCartToken(request: Request): string | undefined {
  const value: unknown = (request.cookies as Record<string, unknown> | undefined)?.[CART_COOKIE]
  return typeof value === 'string' && /^[A-Za-z0-9_-]{64}$/.test(value) ? value : undefined
}

export function writeCartCookie(response: Response, owner: CartOwner, config: ConfigService): void {
  const options: CookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    path: '/cart',
    secure: config.get<string>('COOKIE_SECURE') === 'true',
    domain: config.get<string>('COOKIE_DOMAIN') || undefined,
  }
  if (owner.clearGuestCookie) response.clearCookie(CART_COOKIE, options)
  else if (owner.newGuestToken)
    response.cookie(CART_COOKIE, owner.newGuestToken, {
      ...options,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    })
}
