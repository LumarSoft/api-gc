import { Body, Controller, Delete, Param, Patch, Post, Put, UseGuards } from '@nestjs/common'
import { CurrentAuditActor } from '../common/decorators/audit-actor.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { IdParamDto } from '../common/dto/id-param.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuditActor } from '../common/types/audit-actor'
import { UserRole } from '../generated/prisma/enums'
import { StockService } from '../inventory/stock.service'
import { AdminProductReader } from './admin-product.reader'
import { AdminVariantPricesService } from './admin-variant-prices.service'
import { AdminVariantsService } from './admin-variants.service'
import { AdjustStockDto } from './dto/admin/adjust-stock.dto'
import type { AdminProductDetailDto } from './dto/admin/admin-product-response.dto'
import { CreateVariantDto } from './dto/admin/create-variant.dto'
import { ReplaceVariantPricesDto } from './dto/admin/replace-variant-prices.dto'
import { UpdateVariantDto } from './dto/admin/update-variant.dto'
import { VariantParamDto } from './dto/admin/variant-param.dto'

/** Variants of a product, their prices and (provisionally) their stock. Every answer is the updated product. */
@Controller('admin/products/:id/variants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminVariantsController {
  constructor(
    private readonly variants: AdminVariantsService,
    private readonly prices: AdminVariantPricesService,
    private readonly stock: StockService,
    private readonly reader: AdminProductReader,
  ) {}

  @Post()
  create(
    @Param() params: IdParamDto,
    @Body() dto: CreateVariantDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.variants.create(params.id, dto, actor)
  }

  @Patch(':variantId')
  update(
    @Param() params: VariantParamDto,
    @Body() dto: UpdateVariantDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    return this.variants.update(params.id, params.variantId, dto, actor)
  }

  @Put(':variantId/default')
  setDefault(@Param() params: VariantParamDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminProductDetailDto> {
    return this.variants.setDefault(params.id, params.variantId, actor)
  }

  @Delete(':variantId')
  archive(@Param() params: VariantParamDto, @CurrentAuditActor() actor: AuditActor): Promise<AdminProductDetailDto> {
    return this.variants.archive(params.id, params.variantId, actor)
  }

  @Put(':variantId/prices')
  async replacePrices(
    @Param() params: VariantParamDto,
    @Body() dto: ReplaceVariantPricesDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    await this.variants.findOwn(params.id, params.variantId)
    await this.prices.replace(params.variantId, dto.prices, actor)
    return this.reader.detail(params.id)
  }

  /** TODO(tango): provisional manual stock count until stock is synced from Tango (see StockService). */
  @Put(':variantId/stock')
  async adjustStock(
    @Param() params: VariantParamDto,
    @Body() dto: AdjustStockDto,
    @CurrentAuditActor() actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    await this.variants.findOwn(params.id, params.variantId)
    await this.stock.adjust(params.variantId, dto, actor)
    return this.reader.detail(params.id)
  }
}
