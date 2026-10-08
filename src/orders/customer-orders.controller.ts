import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { CustomerOrdersService } from './customer-orders.service'
import { ListMyOrdersDto, OrderNumberDto } from './dto/order-input.dto'
import type { MyOrdersPageDto, OrderResponseDto } from './dto/order-response.dto'

/** The signed-in customer's own orders. Guests keep using the private tracking link. */
@Controller('orders/mine')
@UseGuards(JwtAuthGuard)
export class CustomerOrdersController {
  constructor(private readonly orders: CustomerOrdersService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMyOrdersDto): Promise<MyOrdersPageDto> {
    return this.orders.list(user, query)
  }

  @Get(':number')
  @Header('Cache-Control', 'private, no-store')
  read(@CurrentUser() user: AuthenticatedUser, @Param() params: OrderNumberDto): Promise<OrderResponseDto> {
    return this.orders.read(user, params.number)
  }
}
