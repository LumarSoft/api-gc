import { Body, Controller, Get, Header, Param, Put, Query, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminOrdersService } from './admin-orders.service'
import { ChangeOrderStatusDto, ListOrdersDto } from './dto/order-input.dto'
import type { OrderCountsDto, OrderResponseDto, OrdersPageDto } from './dto/order-response.dto'
import { OrderStatusService } from './order-status.service'

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly statuses: OrderStatusService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListOrdersDto): Promise<OrdersPageDto> {
    return this.orders.list(query)
  }
  @Get('counts')
  @Header('Cache-Control', 'private, no-store')
  counts(): Promise<OrderCountsDto> {
    return this.orders.counts()
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  read(@Param() params: IdParamDto): Promise<OrderResponseDto> {
    return this.orders.read(params.id)
  }
  @Put(':id/status')
  @Header('Cache-Control', 'private, no-store')
  change(
    @Param() params: IdParamDto,
    @Body() input: ChangeOrderStatusDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<OrderResponseDto> {
    return this.statuses.change(params.id, input, actor)
  }
}
