import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { CreateWholesaleApplicationDto } from './dto/wholesale-application-input.dto'
import type { MyWholesaleApplicationDto } from './dto/wholesale-application-response.dto'
import { WholesaleApplicationsService } from './wholesale-applications.service'

/** Frequent-customer ("clientes frecuentes") applications of the signed-in customer. */
@Controller('wholesale-applications')
@UseGuards(JwtAuthGuard)
export class WholesaleApplicationsController {
  constructor(private readonly applications: WholesaleApplicationsService) {}

  @Get('mine')
  @Header('Cache-Control', 'private, no-store')
  mine(@CurrentUser() user: AuthenticatedUser): Promise<MyWholesaleApplicationDto> {
    return this.applications.mine(user)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateWholesaleApplicationDto,
  ): Promise<MyWholesaleApplicationDto> {
    return this.applications.apply(user, input)
  }
}
