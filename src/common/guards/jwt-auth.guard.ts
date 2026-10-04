import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import { PrismaService } from '../../prisma/prisma.service'
import { ACCESS_TOKEN_COOKIE } from '../constants/auth-cookies'
import type { AuthenticatedUser } from '../types/authenticated-user'
import { resolveBuyerType } from '../utils/buyer-type'

export interface AccessTokenPayload {
  sub: number
}

/**
 * Accepts the access token from the `cg_at` cookie (browser) or an `Authorization: Bearer` header (tools, tests).
 * The user is re-read on every request so a deactivated user or a paused company takes effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>()
    const token = this.extractToken(request)
    if (!token) throw new UnauthorizedException()

    let payload: AccessTokenPayload
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token)
    } catch {
      throw new UnauthorizedException()
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true },
      select: { id: true, email: true, role: true, companyId: true, company: { select: { wholesaleStatus: true } } },
    })
    if (!user) throw new UnauthorizedException()

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      buyerType: resolveBuyerType(user.company?.wholesaleStatus),
    }
    return true
  }

  protected extractToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined
    const fromCookie = cookies?.[ACCESS_TOKEN_COOKIE]
    if (fromCookie) return fromCookie
    const [scheme, value] = request.headers.authorization?.split(' ') ?? []
    return scheme === 'Bearer' ? value : undefined
  }
}
