import { Injectable } from '@nestjs/common'
import { ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { buildVocabulary, type SearchVocabulary } from './lib/product-search-rules'

/** The vocabulary changes when the catalog does, which is rare: rebuilding it this often is enough. */
const VOCABULARY_TTL_MS = 10 * 60_000

/**
 * The words of the catalog (product, category, brand and use names) that misspelled searches are corrected to. Built
 * from the database and kept in memory for a while; one API instance, so no shared cache is needed.
 */
@Injectable()
export class ProductSearchVocabulary {
  private cached: { vocabulary: SearchVocabulary; until: number } | null = null
  private loading: Promise<SearchVocabulary> | null = null

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SearchVocabulary> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.vocabulary
    // Concurrent searches share one load.
    this.loading ??= this.load().finally(() => (this.loading = null))
    return this.loading
  }

  private async load(): Promise<SearchVocabulary> {
    const [products, categories, brands, tags] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: ProductStatus.PUBLISHED, deletedAt: null },
        select: { name: true },
      }),
      this.prisma.category.findMany({ where: { deletedAt: null, isActive: true }, select: { name: true } }),
      this.prisma.brand.findMany({ where: { deletedAt: null, isActive: true }, select: { name: true } }),
      this.prisma.tag.findMany({ where: { deletedAt: null }, select: { name: true } }),
    ])
    const vocabulary = buildVocabulary([...products, ...categories, ...brands, ...tags].map(row => row.name))
    this.cached = { vocabulary, until: Date.now() + VOCABULARY_TTL_MS }
    return vocabulary
  }
}
