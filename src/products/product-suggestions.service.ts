import { Injectable } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { PrismaService } from '../prisma/prisma.service'
import type { CategorySuggestionDto, ProductSuggestionsDto } from './dto/product-response.dto'
import { ProductsService } from './products.service'

/** Products shown while the customer types: enough to recognize the one they want, few enough to load at once. */
const SUGGESTED_PRODUCTS = 6
const SUGGESTED_CATEGORIES = 4
/** Matches counted at most: past this the total reads "1000+" in practice and costs nothing more. */
const MAX_MATCHES = 1000

/**
 * Live search for the store's search box: the same search as `GET /products?q=` (typos corrected, the closest
 * products when none has every word), answered with its first products and the categories the rest are in.
 */
@Injectable()
export class ProductSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async suggest(query: string, user: AuthenticatedUser | undefined): Promise<ProductSuggestionsDto> {
    const match = await this.products.searchIds(query, [], { partial: true, limit: MAX_MATCHES })
    const [products, categories] = await Promise.all([
      this.products.findSummariesByIds(match.ids.slice(0, SUGGESTED_PRODUCTS), user),
      this.categories(match.ids),
    ])
    return {
      query,
      correctedQuery: match.correctedQuery,
      partial: !match.complete && match.ids.length > 0,
      total: match.ids.length,
      products,
      categories,
    }
  }

  /** The categories with the most matches. */
  private async categories(ids: number[]): Promise<CategorySuggestionDto[]> {
    if (!ids.length) return []
    const groups = await this.prisma.product.groupBy({
      by: ['categoryId'],
      where: { id: { in: ids } },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: SUGGESTED_CATEGORIES,
    })
    const categories = await this.prisma.category.findMany({
      where: { id: { in: groups.map(group => group.categoryId) }, deletedAt: null, isActive: true },
      select: { id: true, slug: true, name: true },
    })
    return groups.flatMap(group => {
      const category = categories.find(row => row.id === group.categoryId)
      return category ? [{ slug: category.slug, name: category.name, count: group._count._all }] : []
    })
  }
}
