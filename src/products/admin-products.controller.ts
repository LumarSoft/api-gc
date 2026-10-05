import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { AdminProductContentService } from './admin-product-content.service'
import { AdminProductDuplicatorService } from './admin-product-duplicator.service'
import { AdminProductsService } from './admin-products.service'
import type { AdminProductDetailDto, PaginatedAdminProductsDto } from './dto/admin/admin-product-response.dto'
import { CreateProductDto } from './dto/admin/create-product.dto'
import { ListAdminProductsQueryDto } from './dto/admin/list-admin-products-query.dto'
import { ReplaceProductImagesDto } from './dto/admin/replace-product-images.dto'
import { ReplaceProductSpecificationsDto } from './dto/admin/replace-product-specifications.dto'
import { ReplaceProductTagsDto } from './dto/admin/replace-product-tags.dto'
import { UpdateProductStatusDto } from './dto/admin/update-product-status.dto'
import { UpdateProductDto } from './dto/admin/update-product.dto'

@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminProductsController {
  constructor(
    private readonly products: AdminProductsService,
    private readonly content: AdminProductContentService,
    private readonly duplicator: AdminProductDuplicatorService,
  ) {}

  @Get()
  findAll(@Query() query: ListAdminProductsQueryDto): Promise<PaginatedAdminProductsDto> {
    return this.products.findAll(query)
  }

  @Get(':id')
  findOne(@Param() params: IdParamDto): Promise<AdminProductDetailDto> {
    return this.products.findOne(params.id)
  }

  @Post()
  create(@Body() dto: CreateProductDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminProductDetailDto> {
    return this.products.create(dto, actor)
  }

  @Patch(':id')
  update(
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.products.update(params.id, dto, actor)
  }

  @Put(':id/status')
  setStatus(
    @Param() params: IdParamDto,
    @Body() dto: UpdateProductStatusDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.products.setStatus(params.id, dto.status, actor)
  }

  @Put(':id/images')
  replaceImages(
    @Param() params: IdParamDto,
    @Body() dto: ReplaceProductImagesDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.content.replaceImages(params.id, dto.images, actor)
  }

  @Put(':id/specifications')
  replaceSpecifications(
    @Param() params: IdParamDto,
    @Body() dto: ReplaceProductSpecificationsDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.content.replaceSpecifications(params.id, dto.specifications, actor)
  }

  @Put(':id/tags')
  replaceTags(
    @Param() params: IdParamDto,
    @Body() dto: ReplaceProductTagsDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.content.replaceTags(params.id, dto.tagIds, actor)
  }

  @Post(':id/duplicate')
  duplicate(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminProductDetailDto> {
    return this.duplicator.duplicate(params.id, actor)
  }

  @Delete(':id')
  @HttpCode(204)
  archive(@Param() params: IdParamDto, @CurrentAuditActor() actor: AuditActor): Promise<void> {
    return this.products.archive(params.id, actor)
  }
}
