import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { REFRESH_TOKEN_COOKIE } from '../common/constants/auth-cookies'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { clearAuthCookies, setAuthCookies } from './auth-cookies'
import { AuthService } from './auth.service'
import { RefreshRaceException } from './refresh-race.exception'
import { AuthUserResponseDto } from './dto/auth-user-response.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { VerifyEmailDto } from './dto/verify-email.dto'

/** Brute-force protection for credential endpoints: 5 attempts per minute per IP. */
const STRICT_THROTTLE = { default: { limit: 5, ttl: 60_000 } }

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @Throttle(STRICT_THROTTLE)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserResponseDto> {
    const { user, tokens } = await this.authService.register(dto)
    setAuthCookies(response, tokens, this.config)
    return user
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(STRICT_THROTTLE)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response): Promise<AuthUserResponseDto> {
    const { user, tokens } = await this.authService.login(dto)
    setAuthCookies(response, tokens, this.config)
    return user
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AuthUserResponseDto> {
    try {
      const { user, tokens } = await this.authService.refresh(this.readRefreshToken(request))
      setAuthCookies(response, tokens, this.config)
      return user
    } catch (error) {
      // Keep the cookies when another tab just rotated the token: they already hold the new, valid session.
      if (!(error instanceof RefreshRaceException)) clearAuthCookies(response, this.config)
      throw error
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.authService.logout(this.readRefreshToken(request))
    clearAuthCookies(response, this.config)
  }

  // The front also calls this from its server (admin and account pages), where every visitor shares one IP.
  @Get('me')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserResponseDto> {
    return this.authService.getProfile(user.id)
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(STRICT_THROTTLE)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.authService.forgotPassword(dto)
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(STRICT_THROTTLE)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto)
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.authService.verifyEmail(dto.token)
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Throttle(STRICT_THROTTLE)
  resendVerification(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.authService.resendVerification(user.id)
  }

  private readRefreshToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined
    return cookies?.[REFRESH_TOKEN_COOKIE]
  }
}
