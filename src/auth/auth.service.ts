import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { compare, hash } from 'bcryptjs'
import { resolveBuyerType } from '../common/utils/buyer-type'
import { Prisma } from '../generated/prisma/client'
import { AuthTokenType } from '../generated/prisma/enums'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthUserResponseDto } from './dto/auth-user-response.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { AuthTokenStore, type IssuedTokens } from './auth-token.store'
import { emailVerificationMessage, passwordResetMessage } from './lib/auth-emails'

const BCRYPT_ROUNDS = 12
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000
const EMAIL_VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000
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

export type { IssuedTokens }

export interface AuthResult {
  user: AuthUserResponseDto
  tokens: IssuedTokens
}

/** Orchestrates the account flows. Token handling lives in AuthTokenStore, email texts in lib/auth-emails. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokenStore,
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

    return { user: await this.getProfile(user.id), tokens: await this.tokens.issueSession(user.id) }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null, isActive: true },
      select: { id: true, passwordHash: true },
    })

    const passwordMatches = await compare(dto.password, user?.passwordHash ?? TIMING_EQUALIZER_HASH)
    if (!user || !passwordMatches) throw new UnauthorizedException('Invalid email or password')

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    return { user: await this.getProfile(user.id), tokens: await this.tokens.issueSession(user.id) }
  }

  /** Rotates the refresh token: the presented one is consumed and a new pair is issued. */
  async refresh(rawRefreshToken: string | undefined): Promise<AuthResult> {
    const { userId } = await this.tokens.consumeRefreshToken(rawRefreshToken)
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: { id: true },
    })
    if (!user) throw new UnauthorizedException()
    return { user: await this.getProfile(user.id), tokens: await this.tokens.issueSession(user.id) }
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.tokens.revokeSession(rawRefreshToken)
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

    const token = await this.tokens.createOneTimeToken(user.id, AuthTokenType.PASSWORD_RESET, PASSWORD_RESET_TTL_MS)
    await this.mail.send(passwordResetMessage(user, `${this.frontUrl()}/restablecer-contrasena?token=${token}`))
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const { userId } = await this.tokens.consumeOneTimeToken(dto.token, AuthTokenType.PASSWORD_RESET)
    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS)
    // The new password and logging out every device happen together or not at all.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.tokens.revokeAllSessionsOperation(userId),
    ])
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const { userId } = await this.tokens.consumeOneTimeToken(rawToken, AuthTokenType.EMAIL_VERIFICATION)
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } })
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

  private async sendVerificationEmail(user: { id: number; email: string; firstName: string }): Promise<void> {
    const token = await this.tokens.createOneTimeToken(
      user.id,
      AuthTokenType.EMAIL_VERIFICATION,
      EMAIL_VERIFICATION_TTL_MS,
    )
    await this.mail.send(emailVerificationMessage(user, `${this.frontUrl()}/verificar-email?token=${token}`))
  }

  private frontUrl(): string {
    return (this.config.get<string>('FRONT_URL') ?? 'http://localhost:3000').replace(/\/+$/, '')
  }
}
