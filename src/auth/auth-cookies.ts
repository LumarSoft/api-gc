import type { ConfigService } from '@nestjs/config'
import type { CookieOptions, Response } from 'express'
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_PATH } from '../common/constants/auth-cookies'
import type { IssuedTokens } from './auth.service'

/**
 * Tokens travel only in httpOnly cookies, so page scripts can never read them.
 * In production front and API must share a parent domain (COOKIE_DOMAIN, e.g. ".comunicacionesgraficas.com.ar").
 */
function baseOptions(config: ConfigService): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get<string>('COOKIE_SECURE') === 'true',
    domain: config.get<string>('COOKIE_DOMAIN') || undefined,
  }
}

export function accessTokenTtlMinutes(config: ConfigService): number {
  return Number(config.get<string>('JWT_ACCESS_TTL_MINUTES') ?? 15)
}

export function setAuthCookies(response: Response, tokens: IssuedTokens, config: ConfigService): void {
  const options = baseOptions(config)
  response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...options,
    path: '/',
    maxAge: accessTokenTtlMinutes(config) * 60 * 1000,
  })
  response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...options,
    path: REFRESH_TOKEN_COOKIE_PATH,
    expires: tokens.refreshExpiresAt,
  })
}

export function clearAuthCookies(response: Response, config: ConfigService): void {
  const options = baseOptions(config)
  response.clearCookie(ACCESS_TOKEN_COOKIE, { ...options, path: '/' })
  response.clearCookie(REFRESH_TOKEN_COOKIE, { ...options, path: REFRESH_TOKEN_COOKIE_PATH })
}
