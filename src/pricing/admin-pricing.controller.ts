import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminExchangeRatesService } from './admin-exchange-rates.service'
import {
  CreateExchangeRateDto,
  ExchangeRatesResponseDto,
  ListExchangeRatesQueryDto,
  PriceListDto,
} from './dto/admin-pricing.dto'

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminPricingController {
  constructor(private readonly rates: AdminExchangeRatesService) {}

  @Get('price-lists')
  priceLists(): Promise<PriceListDto[]> {
    return this.rates.priceLists()
  }

  @Get('exchange-rates')
  exchangeRates(@Query() query: ListExchangeRatesQueryDto): Promise<ExchangeRatesResponseDto> {
    return this.rates.list(query.limit)
  }

  @Post('exchange-rates')
  createExchangeRate(
    @Body() dto: CreateExchangeRateDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<ExchangeRatesResponseDto> {
    return this.rates.create(dto, actor)
  }
}
