import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { SkipThrottle, Throttle } from '@nestjs/throttler'
import { OptionalUser } from '../common/decorators/optional-user.decorator'
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import { PaginatedProductsDto, ProductDetailDto, ProductSuggestionsDto } from './dto/product-response.dto'
import { ProductSlugParamDto } from './dto/product-slug-param.dto'
import { SuggestProductsQueryDto } from './dto/suggest-products-query.dto'
import { ProductSuggestionsService } from './product-suggestions.service'
import { ProductsService } from './products.service'

/**
 * Public catalog. Prices depend on the buyer, so a session is read when present but never required.
 * Not rate limited: the front renders it on its server, where every visitor shares one IP (docs/rules/security.md).
 */
@SkipThrottle()
@Controller('products')
@UseGuards(OptionalJwtAuthGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly suggestions: ProductSuggestionsService,
  ) {}

  @Get()
  findAll(
    @Query() query: ListProductsQueryDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<PaginatedProductsDto> {
    return this.productsService.findAll(query, user)
  }

  /**
   * The store's search box asks this while the customer types, from the browser: rate limited per visitor (unlike the
   * routes above), generously, since a debounced search box sends a request every few keystrokes.
   */
  @Get('suggest')
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  suggest(
    @Query() query: SuggestProductsQueryDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<ProductSuggestionsDto> {
    return this.suggestions.suggest(query.q, user)
  }

  @Get(':slug')
  findBySlug(
    @Param() params: ProductSlugParamDto,
    @OptionalUser() user: AuthenticatedUser | undefined,
  ): Promise<ProductDetailDto> {
    return this.productsService.findBySlug(params.slug, user)
  }
}
