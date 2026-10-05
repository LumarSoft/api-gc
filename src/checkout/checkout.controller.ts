import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { readCartToken, writeCartCookie } from '../cart/cart-cookies'
import { OptionalUser } from '../common/decorators/optional-user.decorator'
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { CheckoutService, type CheckoutResult } from './checkout.service'
import { PreviewCheckoutDto } from './dto/checkout-input.dto'
import type { CheckoutResponseDto } from './dto/checkout-response.dto'

/** Under /cart so the guest cookie keeps its existing scope. Browser-only and never shared-cached. */
@Controller('cart/checkout')
@UseGuards(OptionalJwtAuthGuard)
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CheckoutResponseDto> {
    return this.respond(await this.checkout.preview(user, readCartToken(request)), response)
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: PreviewCheckoutDto,
  ): Promise<CheckoutResponseDto> {
    return this.respond(await this.checkout.preview(user, readCartToken(request), input), response)
  }

  private respond(result: CheckoutResult, response: Response): CheckoutResponseDto {
    response.setHeader('Cache-Control', 'private, no-store')
    writeCartCookie(response, result, this.config)
    return result.checkout
  }
}
