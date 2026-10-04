import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { ReorderDto } from '../common/dto/reorder.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminBrandsService } from './admin-brands.service'
import { AdminBrandResponseDto } from './dto/admin-brand-response.dto'
import { CreateBrandDto } from './dto/create-brand.dto'
import { UpdateBrandDto } from './dto/update-brand.dto'

@Controller('admin/brands')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminBrandsController {
  constructor(private readonly brands: AdminBrandsService) {}

  @Get()
  findAll(): Promise<AdminBrandResponseDto[]> {
    return this.brands.findAll()
  }

  @Get(':id')
  findOne(@Param() params: IdParamDto): Promise<AdminBrandResponseDto> {
    return this.brands.findOne(params.id)
  }

  @Post()
  create(@Body() dto: CreateBrandDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminBrandResponseDto> {
    return this.brands.create(dto, actor)
  }

  /** Declared before `:id` routes with the same verb so "order" is never read as an id. */
  @Put('order')
  reorder(@Body() dto: ReorderDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminBrandResponseDto[]> {
    return this.brands.reorder(dto.ids, actor)
  }

  @Patch(':id')
  update(
    @Param() params: IdParamDto,
    @Body() dto: UpdateBrandDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminBrandResponseDto> {
    return this.brands.update(params.id, dto, actor)
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<void> {
    return this.brands.archive(params.id, actor)
  }
}
