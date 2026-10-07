import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminWholesaleApplicationsService } from './admin-wholesale-applications.service'
import { ListWholesaleApplicationsDto, WholesaleDecisionDto } from './dto/wholesale-application-input.dto'
import type {
  AdminWholesaleApplicationDto,
  WholesaleApplicationsPageDto,
} from './dto/wholesale-application-response.dto'

@Controller('admin/wholesale-applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminWholesaleApplicationsController {
  constructor(private readonly applications: AdminWholesaleApplicationsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: ListWholesaleApplicationsDto): Promise<WholesaleApplicationsPageDto> {
    return this.applications.list(query)
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  read(@Param() params: IdParamDto): Promise<AdminWholesaleApplicationDto> {
    return this.applications.read(params.id)
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param() params: IdParamDto,
    @Body() input: WholesaleDecisionDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminWholesaleApplicationDto> {
    return this.applications.decide(params.id, 'approve', input.note, actor)
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param() params: IdParamDto,
    @Body() input: WholesaleDecisionDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminWholesaleApplicationDto> {
    return this.applications.decide(params.id, 'reject', input.note, actor)
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @Param() params: IdParamDto,
    @Body() input: WholesaleDecisionDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminWholesaleApplicationDto> {
    return this.applications.decide(params.id, 'pause', input.note, actor)
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @Param() params: IdParamDto,
    @Body() input: WholesaleDecisionDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminWholesaleApplicationDto> {
    return this.applications.decide(params.id, 'resume', input.note, actor)
  }
}
