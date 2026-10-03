import { ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { compare, hash } from 'bcryptjs'
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard'
import { resolveBuyerType } from '../common/utils/buyer-type'
import { generateSecureToken, hashToken } from '../common/utils/secure-token'
import { Prisma } from '../generated/prisma/client'
import { AuthTokenType } from '../generated/prisma/enums'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthUserResponseDto } from './dto/auth-user-response.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { RefreshRaceException } from './refresh-race.exception'

const BCRYPT_ROUNDS = 12
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000
const EMAIL_VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000
/**
 * A refresh token reused within this window is treated as a race (two tabs refreshing at once), not as theft:
 * the request is rejected but the other sessions stay alive.
 */
const REFRESH_REUSE_GRACE_MS = 30_000
/** Compared against when the email does not exist, so both paths take the same time (no user enumeration). */
const TIMING_EQUALIZER_HASH = '$2b$12$.1ZDhJHaAKzaHwrvpNOiWea/Ccno0vzuriLfT62F7KCkAcfVpRp22'

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  emailVerifiedAt: true,
  company: { select: { id: true, legalName: true, wholesaleStatus: true } },
} as const

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
}

export interface AuthResult {
  user: AuthUserResponseDto
  tokens: IssuedTokens
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } })
    if (existing) throw new ConflictException('An account with this email already exists')

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS)
    const user = await this.prisma.user
      .create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone || null,
          marketingOptIn: dto.marketingOptIn ?? false,
        },
        select: { id: true, email: true, firstName: true },
      })
      .catch((error: unknown) => {
        // Two simultaneous sign-ups with the same email: the unique index decides, the loser gets a 409.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('An account with this email already exists')
        }
        throw error
      })

    await this.sendVerificationEmail(user)

    return { user: await this.getProfile(user.id), tokens: await this.issueTokens(user.id) }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null, isActive: true },
      select: { id: true, passwordHash: true },
    })

    const passwordMatches = await compare(dto.password, user?.passwordHash ?? TIMING_EQUALIZER_HASH)
    if (!user || !passwordMatches) throw new UnauthorizedException('Invalid email or password')

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    return { user: await this.getProfile(user.id), tokens: await this.issueTokens(user.id) }
  }

  /**
   * Rotates the refresh token: the presented one is consumed and a new pair is issued.
   * Presenting an already-used token means it was stolen or replayed, so every session of that user is revoked.
   */
  async refresh(rawRefreshToken: string | undefined): Promise<AuthResult> {
    if (!rawRefreshToken) throw new UnauthorizedException()

    const stored = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawRefreshToken) },
      select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true, deletedAt: true },
    })
    if (!stored || stored.type !== AuthTokenType.REFRESH || stored.deletedAt) throw new UnauthorizedException()

    if (stored.usedAt && Date.now() - stored.usedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
      throw new RefreshRaceException()
    }
    if (stored.usedAt) {
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; revoking all sessions`)
      await this.revokeRefreshTokens(stored.userId)
      throw new UnauthorizedException()
    }
    if (stored.expiresAt <= new Date()) throw new UnauthorizedException()

    const user = await this.prisma.user.findFirst({
      where: { id: stored.userId, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!user) throw new UnauthorizedException()

    const marked = await this.markTokenUsed(stored.id)
    if (!marked) throw new RefreshRaceException()

    return { user: await this.getProfile(user.id), tokens: await this.issueTokens(user.id) }
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return
    await this.prisma.authToken.updateMany({
      where: { tokenHash: hashToken(rawRefreshToken), type: AuthTokenType.REFRESH, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  async getProfile(userId: number): Promise<AuthUserResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: AUTH_USER_SELECT,
    })
    if (!user) throw new NotFoundException('User not found')

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      buyerType: resolveBuyerType(user.company?.wholesaleStatus),
      emailVerified: user.emailVerifiedAt !== null,
      company: user.company,
    }
  }

  /** Always succeeds from the caller's point of view, so it cannot be used to find out which emails exist. */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true },
    })
    if (!user) return

    const token = await this.createOneTimeToken(user.id, AuthTokenType.PASSWORD_RESET, PASSWORD_RESET_TTL_MS)
    const link = `${this.frontUrl()}/restablecer-contrasena?token=${token}`

    await this.mail.send({
      to: user.email,
      template: 'password-reset',
      subject: 'Restablecé tu contraseña',
      text: `Hola ${user.firstName}, para elegir una nueva contraseña entrá a:\n${link}\n\nEl enlace vence en 1 hora. Si no lo pediste, ignorá este correo.`,
      relatedEntity: 'User',
      relatedId: user.id,
    })
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const token = await this.consumeOneTimeToken(dto.token, AuthTokenType.PASSWORD_RESET)

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash: await hash(dto.password, BCRYPT_ROUNDS) },
      }),
      // A password change logs out every device.
      this.prisma.authToken.updateMany({
        where: { userId: token.userId, type: AuthTokenType.REFRESH, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    ])
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const token = await this.consumeOneTimeToken(rawToken, AuthTokenType.EMAIL_VERIFICATION)
    await this.prisma.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } })
  }

  async resendVerification(userId: number): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, firstName: true, emailVerifiedAt: true },
    })
    if (!user) throw new NotFoundException('User not found')
    if (user.emailVerifiedAt) return
    await this.sendVerificationEmail(user)
  }

  private async issueTokens(userId: number): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = { sub: userId }
    const accessToken = await this.jwt.signAsync(payload)

    const refreshToken = generateSecureToken()
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlMs())
    await this.prisma.authToken.create({
      data: {
        userId,
        type: AuthTokenType.REFRESH,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    })

    return { accessToken, refreshToken, refreshExpiresAt }
  }

  private async revokeRefreshTokens(userId: number): Promise<void> {
    await this.prisma.authToken.updateMany({
      where: { userId, type: AuthTokenType.REFRESH, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  /** Creates a link token and invalidates any previous unused one of the same type. */
  private async createOneTimeToken(userId: number, type: AuthTokenType, ttlMs: number): Promise<string> {
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

  private async consumeOneTimeToken(rawToken: string, type: AuthTokenType): Promise<{ userId: number }> {
    const stored = await this.prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { id: true, userId: true, type: true, usedAt: true, expiresAt: true, deletedAt: true },
    })
    const isValid =
      stored && stored.type === type && !stored.usedAt && !stored.deletedAt && stored.expiresAt > new Date()
    if (!isValid) throw new UnauthorizedException('Invalid or expired link')

    if (!(await this.markTokenUsed(stored.id))) throw new UnauthorizedException('Invalid or expired link')
    return { userId: stored.userId }
  }

  /**
   * Marks a token as used only if nobody else did it first, so a double click or two parallel requests
   * cannot use the same token twice. Returns false when another request won.
   */
  private async markTokenUsed(tokenId: number): Promise<boolean> {
    const { count } = await this.prisma.authToken.updateMany({
      where: { id: tokenId, usedAt: null, deletedAt: null },
      data: { usedAt: new Date() },
    })
    return count === 1
  }

  private async sendVerificationEmail(user: { id: number; email: string; firstName: string }): Promise<void> {
    const token = await this.createOneTimeToken(user.id, AuthTokenType.EMAIL_VERIFICATION, EMAIL_VERIFICATION_TTL_MS)
    const link = `${this.frontUrl()}/verificar-email?token=${token}`

    await this.mail.send({
      to: user.email,
      template: 'email-verification',
      subject: 'Confirmá tu email',
      text: `Hola ${user.firstName}, gracias por crear tu cuenta. Confirmá tu email entrando a:\n${link}`,
      relatedEntity: 'User',
      relatedId: user.id,
    })
  }

  private refreshTtlMs(): number {
    return Number(this.config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 24 * 60 * 60 * 1000
  }

  private frontUrl(): string {
    return (this.config.get<string>('FRONT_URL') ?? 'http://localhost:3000').replace(/\/+$/, '')
  }
}
