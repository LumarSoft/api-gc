import { Injectable, NotFoundException } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import { OutOfStockBehavior, ProductStatus } from '../generated/prisma/enums'
import type { PriceContext, ResolvedPrice } from '../pricing/pricing.service'
import { PricingService } from '../pricing/pricing.service'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { ListProductsQueryDto } from './dto/list-products-query.dto'
import type {
  Availability,
  PaginatedProductsDto,
  ProductBadge,
  ProductDetailDto,
  ProductSummaryDto,
  SpecificationGroupDto,
} from './dto/product-response.dto'

/** Below or at this available quantity a product shows "pocas unidades", unless the variant sets its own threshold. */
const DEFAULT_LOW_STOCK_THRESHOLD = 3
/** Products published within this window get the NEW badge. */
const NEW_BADGE_DAYS = 45

function summarySelect(priceListIds: number[]) {
  return {
    id: true,
    slug: true,
    name: true,
    shortDescription: true,
    isFeatured: true,
    outOfStockBehavior: true,
    publishedAt: true,
    brand: { select: { name: true, slug: true } },
    category: { select: { name: true, slug: true } },
    images: {
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 1,
      select: { file: { select: { storageKey: true } } },
    },
    variants: {
      where: { deletedAt: null, isActive: true },
      select: {
        id: true,
        prices: {
          where: { deletedAt: null, priceListId: { in: priceListIds } },
          select: { priceListId: true, amount: true, currency: true, compareAtAmount: true },
        },
        inventory: { select: { onHand: true, reserved: true, lowStockThreshold: true } },
      },
    },
  } satisfies Prisma.ProductSelect
}

type SummaryRow = Prisma.ProductGetPayload<{ select: ReturnType<typeof summarySelect> }>
type InventoryRow = { onHand: number; reserved: number; lowStockThreshold: number | null } | null

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly files: FilesService,
  ) {}

  async findAll(query: ListProductsQueryDto, user: AuthenticatedUser | undefined): Promise<PaginatedProductsDto> {
    const context = await this.pricing.getContext(user)
    const where = await this.buildWhere(query)
    const select = summarySelect(context.priceListIds)

    // Price depends on the buyer and the exchange rate, so price sorting happens after pricing.
    // TODO(catalog): move to a denormalized sort price if the catalog grows to thousands of products.
    if (query.sort === 'price-asc' || query.sort === 'price-desc') {
      const rows = await this.prisma.product.findMany({ where, select })
      const direction = query.sort === 'price-asc' ? 1 : -1
      const sorted = rows
        .map(row => this.toSummary(row, context))
        .sort((a, b) => (a.price && b.price ? direction : 1) * comparePrices(a, b))
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
      rows.map(row => this.toSummary(row, context)),
      total,
      query,
    )
  }

  async findBySlug(slug: string, user: AuthenticatedUser | undefined): Promise<ProductDetailDto> {
    const context = await this.pricing.getContext(user)
    const summary = summarySelect(context.priceListIds)

    const product = await this.prisma.product.findFirst({
      where: { slug, ...this.visibleWhere() },
      select: {
        ...summary,
        description: true,
        warrantyMonths: true,
        seoTitle: true,
        seoDescription: true,
        category: { select: { name: true, slug: true, parent: { select: { name: true, slug: true } } } },
        images: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { altText: true, variantId: true, file: { select: { storageKey: true } } },
        },
        variants: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
          select: {
            ...summary.variants.select,
            sku: true,
            name: true,
            optionValues: true,
            isDefault: true,
            saleUnit: true,
            unitsPerSaleUnit: true,
          },
        },
        specifications: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { groupName: true, name: true, value: true },
        },
        tags: { select: { tag: { select: { name: true, slug: true, group: true, deletedAt: true } } } },
        compatibleWith: { select: { targetProduct: { select: { ...summary, status: true, deletedAt: true } } } },
        compatibleConsumables: { select: { product: { select: { ...summary, status: true, deletedAt: true } } } },
      },
    })
    if (!product) throw new NotFoundException(`Product ${slug} not found`)

    const isVisible = (related: { status: ProductStatus; deletedAt: Date | null }): boolean =>
      related.status === ProductStatus.PUBLISHED && related.deletedAt === null

    return {
      ...this.toSummary(product, context),
      category: { name: product.category.name, slug: product.category.slug },
      parentCategory: product.category.parent,
      description: product.description,
      warrantyMonths: product.warrantyMonths,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      images: product.images.map(image => ({
        url: this.files.publicUrl(image.file.storageKey),
        alt: image.altText ?? product.name,
        variantId: image.variantId,
      })),
      variants: product.variants.map(variant => {
        const resolved = this.pricing.resolve(variant.prices, context)
        return {
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          optionValues: (variant.optionValues as Record<string, string> | null) ?? null,
          isDefault: variant.isDefault,
          saleUnit: variant.saleUnit,
          unitsPerSaleUnit: variant.unitsPerSaleUnit,
          price: resolved?.price ?? null,
          compareAtPrice: resolved?.compareAtPrice ?? null,
          availability: availabilityOf(variant.inventory),
        }
      }),
      specifications: groupSpecifications(product.specifications),
      tags: product.tags
        .filter(({ tag }) => tag.deletedAt === null)
        .map(({ tag }) => ({
          name: tag.name,
          slug: tag.slug,
          group: tag.group,
        })),
      compatibleWith: product.compatibleWith
        .map(({ targetProduct }) => targetProduct)
        .filter(isVisible)
        .map(row => this.toSummary(row, context)),
      compatibleConsumables: product.compatibleConsumables
        .map(({ product: consumable }) => consumable)
        .filter(isVisible)
        .map(row => this.toSummary(row, context)),
    }
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

    if (query.category) {
      const category = await this.prisma.category.findFirst({
        where: { slug: query.category, deletedAt: null, isActive: true },
        select: { id: true, children: { where: { deletedAt: null, isActive: true }, select: { id: true } } },
      })
      if (!category) throw new NotFoundException(`Category ${query.category} not found`)
      filters.push({ categoryId: { in: [category.id, ...category.children.map(child => child.id)] } })
    }
    if (query.brand?.length) filters.push({ brand: { slug: { in: query.brand }, deletedAt: null } })
    if (query.tag?.length) filters.push({ tags: { some: { tag: { slug: { in: query.tag }, deletedAt: null } } } })
    if (query.featured) filters.push({ isFeatured: true })
    if (query.q) {
      // The MySQL collation (utf8mb4_unicode_ci) already makes `contains` case- and accent-insensitive.
      filters.push({
        OR: [
          { name: { contains: query.q } },
          { shortDescription: { contains: query.q } },
          { variants: { some: { sku: { contains: query.q }, deletedAt: null } } },
        ],
      })
    }
    return { AND: filters }
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

  private toSummary(row: SummaryRow, context: PriceContext): ProductSummaryDto {
    const cheapest = row.variants
      .map(variant => this.pricing.resolve(variant.prices, context))
      .filter((resolved): resolved is ResolvedPrice => resolved !== null)
      .sort((a, b) => Number(a.price.amount) - Number(b.price.amount))[0]

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      brand: row.brand,
      category: row.category,
      imageUrl: row.images[0] ? this.files.publicUrl(row.images[0].file.storageKey) : null,
      price: cheapest?.price ?? null,
      compareAtPrice: cheapest?.compareAtPrice ?? null,
      badge: badgeOf(cheapest, row.publishedAt),
      isFeatured: row.isFeatured,
      availability: bestAvailability(row.variants.map(variant => availabilityOf(variant.inventory))),
      outOfStockBehavior: row.outOfStockBehavior,
      variantCount: row.variants.length,
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

function availabilityOf(inventory: InventoryRow): Availability {
  const available = inventory ? inventory.onHand - inventory.reserved : 0
  if (available <= 0) return 'OUT_OF_STOCK'
  return available <= (inventory?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD) ? 'LOW_STOCK' : 'IN_STOCK'
}

function bestAvailability(values: Availability[]): Availability {
  if (values.includes('IN_STOCK')) return 'IN_STOCK'
  if (values.includes('LOW_STOCK')) return 'LOW_STOCK'
  return 'OUT_OF_STOCK'
}

function badgeOf(price: ResolvedPrice | undefined, publishedAt: Date | null): ProductBadge | null {
  if (price?.compareAtPrice && Number(price.compareAtPrice.amount) > Number(price.price.amount)) return 'OFFER'
  if (publishedAt && Date.now() - publishedAt.getTime() < NEW_BADGE_DAYS * 24 * 60 * 60 * 1000) return 'NEW'
  return null
}

/** Products without a price go last in both directions. Comparison only: never used to compute money. */
function comparePrices(a: ProductSummaryDto, b: ProductSummaryDto): number {
  if (!a.price) return b.price ? 1 : 0
  if (!b.price) return -1
  return Number(a.price.amount) - Number(b.price.amount)
}

function groupSpecifications(
  rows: { groupName: string | null; name: string; value: string }[],
): SpecificationGroupDto[] {
  const groups: SpecificationGroupDto[] = []
  for (const row of rows) {
    let group = groups.find(existing => existing.group === row.groupName)
    if (!group) {
      group = { group: row.groupName, items: [] }
      groups.push(group)
    }
    group.items.push({ name: row.name, value: row.value })
  }
  return groups
}
