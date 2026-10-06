import { Body, Controller, Header, HttpCode, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { OrderNumberDto, TrackOrderDto } from './dto/order-input.dto'
import type { OrderResponseDto } from './dto/order-response.dto'
import { OrdersService } from './orders.service'

/** Tracking is a bearer capability: a number/email alone never grants access. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post('recover')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  recover(@Body() input: TrackOrderDto): Promise<OrderResponseDto> {
    return this.orders.recover(input.accessToken)
  }
  @Post(':number/track')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  track(@Param() params: OrderNumberDto, @Body() input: TrackOrderDto): Promise<OrderResponseDto> {
    return this.orders.track(params.number, input.accessToken)
  }
}
