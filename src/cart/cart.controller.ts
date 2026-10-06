import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { OptionalUser } from '../common/decorators/optional-user.decorator'
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { readCartToken, writeCartCookie } from './cart-cookies'
import { CartService, type CartResult } from './cart.service'
import { AddCartItemDto, CartQuantityDto, CartVariantParamDto } from './dto/cart-input.dto'
import type { CartResponseDto } from './dto/cart-response.dto'

/** Browser-only routes: keep per-visitor throttling; all ownership comes from httpOnly cookies. */
@Controller('cart')
@UseGuards(OptionalJwtAuthGuard)
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async read(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponseDto> {
    return this.respond(await this.cartService.read(user, readCartToken(request)), response)
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  async add(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: AddCartItemDto,
  ): Promise<CartResponseDto> {
    return this.respond(await this.cartService.add(user, readCartToken(request), input), response)
  }

  @Patch('items/:variantId')
  async set(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param() params: CartVariantParamDto,
    @Body() input: CartQuantityDto,
  ): Promise<CartResponseDto> {
    return this.respond(await this.cartService.set(user, readCartToken(request), params.variantId, input), response)
  }

  @Delete('items/:variantId')
  async remove(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param() params: CartVariantParamDto,
  ): Promise<CartResponseDto> {
    return this.respond(await this.cartService.remove(user, readCartToken(request), params.variantId), response)
  }

  @Delete()
  async clear(
    @OptionalUser() user: AuthenticatedUser | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CartResponseDto> {
    return this.respond(await this.cartService.clear(user, readCartToken(request)), response)
  }

  private respond(result: CartResult, response: Response): CartResponseDto {
    response.setHeader('Cache-Control', 'private, no-store')
    writeCartCookie(response, result, this.config)
    return result.cart
  }
}
