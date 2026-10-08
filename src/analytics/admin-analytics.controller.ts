import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UserRole } from '../generated/prisma/enums'
import { AnalyticsService } from './analytics.service'
import { BehaviorAnalyticsService } from './behavior-analytics.service'
import { AnalyticsQueryDto } from './dto/analytics-query.dto'
import type { AdminAnalyticsDto } from './dto/analytics-response.dto'
import type { AdminBehaviorDto } from './dto/behavior-response.dto'

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly behavior: BehaviorAnalyticsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: AnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    return this.analytics.report(query)
  }

  /** What anonymous visitors did: funnel, most viewed products, searches and abandoned carts. */
  @Get('behavior')
  @Header('Cache-Control', 'private, no-store')
  behaviorReport(@Query() query: AnalyticsQueryDto): Promise<AdminBehaviorDto> {
    return this.behavior.report(query)
  }
}
