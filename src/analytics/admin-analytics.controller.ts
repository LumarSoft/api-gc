import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UserRole } from '../generated/prisma/enums'
import { AnalyticsService } from './analytics.service'
import { AnalyticsQueryDto } from './dto/analytics-query.dto'
import type { AdminAnalyticsDto } from './dto/analytics-response.dto'

@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: AnalyticsQueryDto): Promise<AdminAnalyticsDto> {
    return this.analytics.report(query)
  }
}
