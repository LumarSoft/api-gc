import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UserRole } from '../generated/prisma/enums'
import { AdminSystemService } from './admin-system.service'
import { ListSystemActivityDto, ListSystemLogsDto } from './dto/system-list-query.dto'
import type { SystemActivityPageDto, SystemLogsPageDto } from './dto/system-list-response.dto'
import type { SystemStatusDto } from './dto/system-status.dto'
import { SystemActivityService } from './system-activity.service'
import { SystemLogsService } from './system-logs.service'

// Developers only (agreed 2026-10-22): the store's staff do not see how the system works inside.
@Controller('admin/system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DEVELOPER)
export class AdminSystemController {
  constructor(
    private readonly system: AdminSystemService,
    private readonly logs: SystemLogsService,
    private readonly activity: SystemActivityService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(): Promise<SystemStatusDto> {
    return this.system.status()
  }

  @Get('logs')
  @Header('Cache-Control', 'private, no-store')
  listLogs(@Query() query: ListSystemLogsDto): Promise<SystemLogsPageDto> {
    return this.logs.list(query)
  }

  @Get('activity')
  @Header('Cache-Control', 'private, no-store')
  listActivity(@Query() query: ListSystemActivityDto): Promise<SystemActivityPageDto> {
    return this.activity.list(query)
  }
}
