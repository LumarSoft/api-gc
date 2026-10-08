import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UserRole } from '../generated/prisma/enums'
import { DashboardService } from './dashboard.service'
import { DashboardQueryDto } from './dto/dashboard-query.dto'
import type { AdminDashboardDto } from './dto/dashboard-response.dto'

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  summary(@Query() query: DashboardQueryDto): Promise<AdminDashboardDto> {
    return this.dashboard.summary(query)
  }
}
