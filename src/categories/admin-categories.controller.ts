import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { ReorderDto } from '../common/dto/reorder.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminCategoriesService } from './admin-categories.service'
import { AdminCategoryResponseDto } from './dto/admin-category-response.dto'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'

@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  findTree(): Promise<AdminCategoryResponseDto[]> {
    return this.categories.findTree()
  }

  @Get(':id')
  findOne(@Param() params: IdParamDto): Promise<AdminCategoryResponseDto> {
    return this.categories.findOne(params.id)
  }

  @Post()
  create(@Body() dto: CreateCategoryDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminCategoryResponseDto> {
    return this.categories.create(dto, actor)
  }

  /** Declared before `:id` routes with the same verb so "order" is never read as an id. */
  @Put('order')
  reorder(@Body() dto: ReorderDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminCategoryResponseDto[]> {
    return this.categories.reorder(dto.ids, actor)
  }

  @Patch(':id')
  update(
    @Param() params: IdParamDto,
    @Body() dto: UpdateCategoryDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminCategoryResponseDto> {
    return this.categories.update(params.id, dto, actor)
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<void> {
    return this.categories.archive(params.id, actor)
  }
}
