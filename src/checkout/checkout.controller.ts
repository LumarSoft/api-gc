import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { readCartToken, writeCartCookie } from '../cart/cart-cookies'
import { OptionalUser } from '../common/decorators/optional-user.decorator'
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { CheckoutService, type CheckoutResult } from './checkout.service'
import { PreviewCheckoutDto, QuoteShippingDto } from './dto/checkout-input.dto'
import type { CheckoutResponseDto } from './dto/checkout-response.dto'
import { OrdersService } from '../orders/orders.service'
import { PlaceOrderDto } from '../orders/dto/order-input.dto'
import type { OrderResponseDto } from '../orders/dto/order-response.dto'
import type { ShippingQuotesResponseDto } from '../shipping/dto/shipping-quote-response.dto'

/** Under /cart so the guest cookie keeps its existing scope. Browser-only and never shared-cached. */
@Controller('cart/checkout')
@UseGuards(OptionalJwtAuthGuard)
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
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

  /** Each call asks the carrier provider for prices, so it has its own, lower limit. */
  @Post('shipping-quotes')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async quoteShipping(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: QuoteShippingDto,
  ): Promise<ShippingQuotesResponseDto> {
    const result = await this.checkout.quoteShipping(user, readCartToken(request), input)
    response.setHeader('Cache-Control', 'private, no-store')
    writeCartCookie(response, result, this.config)
    return result.quotes
  }

  private respond(result: CheckoutResult, response: Response): CheckoutResponseDto {
    response.setHeader('Cache-Control', 'private, no-store')
    writeCartCookie(response, result, this.config)
    return result.checkout
  }

  @Post('orders')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  place(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Body() input: PlaceOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orders.place(user, readCartToken(request), input)
  }
}
