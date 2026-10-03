import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard'
import { generateSecureToken, hashToken } from '../common/utils/secure-token'
import { Prisma } from '../generated/prisma/client'
import { AuthTokenType } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { RefreshRaceException } from './refresh-race.exception'

/**
 * A refresh token reused within this window is treated as a race (two tabs refreshing at once), not as theft:
 * the request is rejected but the other sessions stay alive.
 */
const REFRESH_REUSE_GRACE_MS = 30_000

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
}

/** Every token the auth flows use: session tokens (JWT + rotating refresh) and one-time link tokens. */
@Injectable()
export class AuthTokenStore {
  private readonly logger = new Logger(AuthTokenStore.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issueSession(userId: number): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = { sub: userId }
    const accessToken = await this.jwt.signAsync(payload)

    const refreshToken = generateSecureToken()
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs())
    await this.prisma.authToken.create({
      data: { userId, type: AuthTokenType.REFRESH, tokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt },
    })
    return { accessToken, refreshToken, refreshExpiresAt }
  }

  /**
   * Consumes a refresh token and returns its user. Presenting an already-used token (outside the two-tab grace
   * window) means it was stolen or replayed, so every session of that user is revoked.
   */
  async consumeRefreshToken(rawToken: string | undefined): Promise<{ userId: number }> {
    if (!rawToken) throw new UnauthorizedException()

    const stored = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true, deletedAt: true },
    })
    if (!stored || stored.type !== AuthTokenType.REFRESH || stored.deletedAt) throw new UnauthorizedException()

    if (stored.usedAt && Date.now() - stored.usedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
      throw new RefreshRaceException()
    }
    if (stored.usedAt) {
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; revoking all sessions`)
      await this.revokeAllSessions(stored.userId)
      throw new UnauthorizedException()
    }
    if (stored.expiresAt <= new Date()) throw new UnauthorizedException()
    if (!(await this.markUsed(stored.id))) throw new RefreshRaceException()

    return { userId: stored.userId }
  }

  async revokeSession(rawRefreshToken: string): Promise<void> {
    await this.prisma.authToken.updateMany({
      where: { tokenHash: hashToken(rawRefreshToken), type: AuthTokenType.REFRESH, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  async revokeAllSessions(userId: number): Promise<void> {
    await this.revokeAllSessionsOperation(userId)
  }

  /** Not awaited, so callers can include it in a `prisma.$transaction([...])` with their own writes. */
  revokeAllSessionsOperation(userId: number): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return this.prisma.authToken.updateMany({
      where: { userId, type: AuthTokenType.REFRESH, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  /** Creates a link token and invalidates any previous unused one of the same type. */
  async createOneTimeToken(userId: number, type: AuthTokenType, ttlMs: number): Promise<string> {
    const token = generateSecureToken()
    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId, type, usedAt: null, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      this.prisma.authToken.create({
        data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
      }),
    ])
    return token
  }

  async consumeOneTimeToken(rawToken: string, type: AuthTokenType): Promise<{ userId: number }> {
    const stored = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true, deletedAt: true },
    })
    const isValid =
      stored && stored.type === type && !stored.usedAt && !stored.deletedAt && stored.expiresAt > new Date()
    if (!isValid || !(await this.markUsed(stored.id))) throw new UnauthorizedException('Invalid or expired link')
    return { userId: stored.userId }
  }

  /**
   * Marks a token as used only if nobody else did it first, so a double click or two parallel requests
   * cannot use the same token twice. Returns false when another request won.
   */
  private async markUsed(tokenId: number): Promise<boolean> {
    const { count } = await this.prisma.authToken.updateMany({
      where: { id: tokenId, usedAt: null, deletedAt: null },
      data: { usedAt: new Date() },
    })
    return count === 1
  }

  private refreshTtlMs(): number {
    return Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 24 * 60 * 60 * 1000
  }
}
