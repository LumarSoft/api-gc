import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { OptionalUser } from '../common/decorators/optional-user.decorator'
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import { PaginatedProductsDto, ProductDetailDto } from './dto/product-response.dto'
import { ProductSlugParamDto } from './dto/product-slug-param.dto'
import { ProductsService } from './products.service'

/**
 * Public catalog. Prices depend on the buyer, so a session is read when present but never required.
 * Not rate limited: the front renders it on its server, where every visitor shares one IP (docs/rules/security.md).
 */
@SkipThrottle()
@Controller('products')
@UseGuards(OptionalJwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(
    @Query() query: ListProductsQueryDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<PaginatedProductsDto> {
    return this.productsService.findAll(query, user)
  }

  @Get(':slug')
  findBySlug(
    @Param() params: ProductSlugParamDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<ProductDetailDto> {
    return this.productsService.findBySlug(params.slug, user)
  }
}
