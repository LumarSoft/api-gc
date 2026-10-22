import { Controller, Get, Header, UseGuards } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { UserRole } from '../generated/prisma/enums'
import { AdminSystemService } from './admin-system.service'
import type { SystemStatusDto } from './dto/system-status.dto'

// Developers only (agreed 2026-10-22): the store's staff do not see how the system works inside.
@Controller('admin/system')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DEVELOPER)
export class AdminSystemController {
  constructor(private readonly system: AdminSystemService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(): Promise<SystemStatusDto> {
    return this.system.status()
  }
}
