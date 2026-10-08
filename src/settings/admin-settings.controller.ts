import { Body, Controller, Get, Header, Put, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminSettingsService } from './admin-settings.service'
import { UpdateLocalDeliveryDto, UpdateReservationDto } from './dto/settings-input.dto'
import type { AdminSettingsDto } from './dto/settings-response.dto'

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  read(): Promise<AdminSettingsDto> {
    return this.settings.read()
  }

  @Put('local-delivery')
  updateLocalDelivery(
    @Body() dto: UpdateLocalDeliveryDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminSettingsDto> {
    return this.settings.updateLocalDelivery(dto, actor)
  }

  @Put('reservation')
  updateReservation(
    @Body() dto: UpdateReservationDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminSettingsDto> {
    return this.settings.updateReservation(dto, actor)
  }
}
