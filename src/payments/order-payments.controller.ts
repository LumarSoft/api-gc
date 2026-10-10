import { Body, Controller, Header, HttpCode, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { OrderNumberDto, TrackOrderDto } from '../orders/dto/order-input.dto'
import type { OrderResponseDto } from '../orders/dto/order-response.dto'
import type { MercadoPagoCheckoutResponseDto } from './dto/mercado-pago-checkout-response.dto'
import { MercadoPagoCheckoutService } from './mercado-pago-checkout.service'

/** Paying an order online. Like tracking, the private access token (in the body) authorizes it. */
@Controller('orders/:number/mercado-pago')
export class OrderPaymentsController {
  constructor(private readonly checkout: MercadoPagoCheckoutService) {}

  /** Each call creates a checkout at Mercado Pago, so it has its own, lower limit. */
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pay(@Param() params: OrderNumberDto, @Body() input: TrackOrderDto): Promise<MercadoPagoCheckoutResponseDto> {
    return this.checkout.checkout(params.number, input.accessToken)
  }

  /** Called when the buyer comes back from Mercado Pago: reads the payment there, then answers like tracking. */
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Param() params: OrderNumberDto, @Body() input: TrackOrderDto): Promise<OrderResponseDto> {
    return this.checkout.refresh(params.number, input.accessToken)
  }
}
