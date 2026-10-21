import { Injectable, NotFoundException } from '@nestjs/common'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { Prisma } from '../generated/prisma/client'
import { ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ProductSummaryDto } from '../products/dto/product-response.dto'
import { compareByPrice } from '../products/lib/product-rules'
import { ProductsService } from '../products/products.service'
import type { AssistantProductCardDto } from './dto/assistant-stream.dto'
import type { SearchArguments } from './lib/assistant-tools'
import { productLine, productSheet, searchWords, withinBudget } from './lib/catalog-search-rules'

/** Results the model reads per search: enough to compare, short enough to keep the call cheap. */
const SEARCH_RESULTS = 8
/** Candidates priced per search, before the budget and offer filters. */
const SEARCH_CANDIDATES = 60

export interface SearchResult {
  total: number
  /** True when no product matched every word and the results match only some of them. */
  partialMatch: boolean
  products: ReturnType<typeof productLine>[]
}

/**
 * The catalog as the assistant sees it. Visibility and prices always come from `ProductsService`, so the assistant
 * shows exactly what the store shows to this buyer.
 */
@Injectable()
export class AssistantCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async search(search: SearchArguments, user: AuthenticatedUser | undefined): Promise<SearchResult> {
    const filters = await this.filters(search)
    const words = search.text ? searchWords(search.text) : []
    let partialMatch = false
    let ids = await this.candidateIds([...filters, ...words.map(word => ({ OR: this.wordMatch(word) }))])
    // "impresora fotográfica wifi a3": when no product has every word, the ones with some of them still help.
    if (!ids.length && words.length > 1) {
      partialMatch = true
      ids = await this.candidateIds([...filters, { OR: words.flatMap(word => this.wordMatch(word)) }])
    }

    let items = (await this.products.findSummariesByIds(ids, user)).filter(
      item => withinBudget(item.price, search.maxPrice) && (!search.onSale || item.badge === 'OFFER'),
    )
    if (search.sort !== 'relevance')
      items = items.sort((a, b) => compareByPrice(a, b, search.sort === 'price-asc' ? 1 : -1))
    return { total: items.length, partialMatch, products: items.slice(0, SEARCH_RESULTS).map(productLine) }
  }

  async sheet(slug: string, user: AuthenticatedUser | undefined): Promise<ReturnType<typeof productSheet> | null> {
    try {
      return productSheet(await this.products.findBySlug(slug, user))
    } catch (error) {
      if (error instanceof NotFoundException) return null
      throw error
    }
  }

  /** Cards of the visible products among `slugs`, in that order. Unknown or hidden slugs are skipped. */
  async cards(slugs: string[], user: AuthenticatedUser | undefined): Promise<AssistantProductCardDto[]> {
    const rows = await this.prisma.product.findMany({
      where: { slug: { in: slugs }, deletedAt: null },
      select: { id: true, slug: true },
    })
    const ids = slugs.flatMap(slug => rows.find(row => row.slug === slug)?.id ?? [])
    const summaries = await this.products.findSummariesByIds(ids, user)
    const variants = await this.singleVariants(summaries)
    return summaries.map(summary => ({ ...summary, variantId: variants.get(summary.id) ?? null }))
  }

  /** Name of a visible product, to tell the model which page the customer is on. */
  async visibleName(slug: string): Promise<string | null> {
    const product = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null, status: ProductStatus.PUBLISHED },
      select: { id: true, name: true },
    })
    return product && (await this.products.isVisible(product.id)) ? product.name : null
  }

  private async candidateIds(filters: Prisma.ProductWhereInput[]): Promise<number[]> {
    const rows = await this.prisma.product.findMany({
      where: { AND: [{ status: ProductStatus.PUBLISHED, deletedAt: null }, ...filters] },
      select: { id: true },
      orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      take: SEARCH_CANDIDATES,
    })
    return rows.map(row => row.id)
  }

  /** Category (with its subcategories) and use filters. Unknown slugs are an error the model can correct. */
  private async filters(search: SearchArguments): Promise<Prisma.ProductWhereInput[]> {
    const filters: Prisma.ProductWhereInput[] = []
    if (search.category) {
      const category = await this.prisma.category.findFirst({
        where: { slug: search.category, deletedAt: null, isActive: true },
        select: { id: true, children: { where: { deletedAt: null, isActive: true }, select: { id: true } } },
      })
      if (!category)
        throw new NotFoundException(`No existe la categoría "${search.category}". Usá el mapa del catálogo.`)
      filters.push({ categoryId: { in: [category.id, ...category.children.map(child => child.id)] } })
    }
    if (search.use) filters.push({ tags: { some: { tag: { slug: search.use, deletedAt: null } } } })
    return filters
  }

  /** A word matches the name, summary, a SKU, the category, the brand or a tag. */
  private wordMatch(word: string): Prisma.ProductWhereInput[] {
    // `contains` becomes LIKE: escape % and _ so they are searched literally.
    const term = word.replace(/[\\%_]/g, '\\$&')
    return [
      { name: { contains: term } },
      { shortDescription: { contains: term } },
      { variants: { some: { sku: { contains: term }, deletedAt: null } } },
      { category: { name: { contains: term } } },
      { brand: { name: { contains: term } } },
      { tags: { some: { tag: { name: { contains: term }, deletedAt: null } } } },
    ]
  }

  /** The only active variant of each product that has exactly one: the card can add it to the cart directly. */
  private async singleVariants(products: ProductSummaryDto[]): Promise<Map<number, number>> {
    const single = products.filter(product => product.variantCount === 1).map(product => product.id)
    if (!single.length) return new Map()
    const variants = await this.prisma.productVariant.findMany({
      where: { productId: { in: single }, deletedAt: null, isActive: true },
      select: { id: true, productId: true },
    })
    return new Map(variants.map(variant => [variant.productId, variant.id]))
  }
}
