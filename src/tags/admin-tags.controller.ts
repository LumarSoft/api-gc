import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminTagsService } from './admin-tags.service'
import { CreateTagDto } from './dto/create-tag.dto'
import { AdminTagResponseDto } from './dto/tag-response.dto'
import { UpdateTagDto } from './dto/update-tag.dto'

@Controller('admin/tags')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTagsController {
  constructor(private readonly tags: AdminTagsService) {}

  @Get()
  findAll(): Promise<AdminTagResponseDto[]> {
    return this.tags.findAll()
  }

  @Get(':id')
  findOne(@Param() params: IdParamDto): Promise<AdminTagResponseDto> {
    return this.tags.findOne(params.id)
  }

  @Post()
  create(@Body() dto: CreateTagDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminTagResponseDto> {
    return this.tags.create(dto, actor)
  }

  @Patch(':id')
  update(
    @Param() params: IdParamDto,
    @Body() dto: UpdateTagDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminTagResponseDto> {
    return this.tags.update(params.id, dto, actor)
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<void> {
    return this.tags.archive(params.id, actor)
  }
}
