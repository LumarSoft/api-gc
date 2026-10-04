import { Injectable, NotFoundException } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { Prisma } from '../generated/prisma/client'
import { OutOfStockBehavior, ProductStatus } from '../generated/prisma/enums'
import { PricingService } from '../pricing/pricing.service'
import { PrismaService } from '../prisma/prisma.service'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import type { PaginatedProductsDto, ProductDetailDto, ProductSummaryDto } from './dto/product-response.dto'
import { compareByPrice } from './lib/product-rules'
import { detailSelect, summarySelect } from './lib/product-selects'
import { ProductMapper } from './product.mapper'

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly mapper: ProductMapper,
  ) {}

  async findAll(query: ListProductsQueryDto, user: AuthenticatedUser | undefined): Promise<PaginatedProductsDto> {
    const context = await this.pricing.getContext(user)
    const where = await this.buildWhere(query)
    const select = summarySelect(context.priceListIds)

    // Price depends on the buyer and the exchange rate, so price sorting happens after pricing.
    // TODO(catalog): move to a denormalized sort price if the catalog grows to thousands of products.
    if (query.sort === 'price-asc' || query.sort === 'price-desc') {
      const direction = query.sort === 'price-asc' ? 1 : -1
      const rows = await this.prisma.product.findMany({ where, select })
      const sorted = rows
        .map(row => this.mapper.toSummary(row, context))
        .sort((a, b) => compareByPrice(a, b, direction))
      const start = (query.page - 1) * query.pageSize
      return this.page(sorted.slice(start, start + query.pageSize), sorted.length, query)
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select,
        orderBy: this.orderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ])
    return this.page(
      rows.map(row => this.mapper.toSummary(row, context)),
      total,
      query,
    )
  }

  async findBySlug(slug: string, user: AuthenticatedUser | undefined): Promise<ProductDetailDto> {
    const context = await this.pricing.getContext(user)
    const product = await this.prisma.product.findFirst({
      where: { slug, ...this.visibleWhere() },
      select: detailSelect(context.priceListIds),
    })
    if (!product) throw new NotFoundException(`Product ${slug} not found`)
    return this.mapper.toDetail(product, context)
  }

  /** Published, not deleted, and not hidden for being out of stock. */
  private visibleWhere(): Prisma.ProductWhereInput {
    return {
      status: ProductStatus.PUBLISHED,
      deletedAt: null,
      OR: [
        { outOfStockBehavior: { not: OutOfStockBehavior.HIDE } },
        {
          variants: {
            some: {
              deletedAt: null,
              isActive: true,
              inventory: { is: { onHand: { gt: this.prisma.inventoryLevel.fields.reserved } } },
            },
          },
        },
      ],
    }
  }

  private async buildWhere(query: ListProductsQueryDto): Promise<Prisma.ProductWhereInput> {
    const filters: Prisma.ProductWhereInput[] = [this.visibleWhere()]

    if (query.category) filters.push({ categoryId: { in: await this.categoryWithChildrenIds(query.category) } })
    if (query.brand?.length) filters.push({ brand: { slug: { in: query.brand }, deletedAt: null } })
    if (query.tag?.length) filters.push({ tags: { some: { tag: { slug: { in: query.tag }, deletedAt: null } } } })
    if (query.featured) filters.push({ isFeatured: true })
    if (query.q) {
      // `contains` becomes LIKE: escape % and _ so they are searched literally, not as wildcards.
      // The MySQL collation (utf8mb4_unicode_ci) already makes it case- and accent-insensitive.
      const term = query.q.replace(/[\\%_]/g, '\\$&')
      filters.push({
        OR: [
          { name: { contains: term } },
          { shortDescription: { contains: term } },
          { variants: { some: { sku: { contains: term }, deletedAt: null } } },
        ],
      })
    }
    return { AND: filters }
  }

  private async categoryWithChildrenIds(slug: string): Promise<number[]> {
    const category = await this.prisma.category.findFirst({
      where: { slug, deletedAt: null, isActive: true },
      select: { id: true, children: { where: { deletedAt: null, isActive: true }, select: { id: true } } },
    })
    if (!category) throw new NotFoundException(`Category ${slug} not found`)
    return [category.id, ...category.children.map(child => child.id)]
  }

  private orderBy(query: ListProductsQueryDto): Prisma.ProductOrderByWithRelationInput[] {
    switch (query.sort) {
      case 'newest':
        return [{ publishedAt: 'desc' }, { id: 'desc' }]
      case 'name':
        return [{ name: 'asc' }, { id: 'asc' }]
      default:
        return [{ isFeatured: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }]
    }
  }

  private page(items: ProductSummaryDto[], total: number, query: ListProductsQueryDto): PaginatedProductsDto {
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }
}
