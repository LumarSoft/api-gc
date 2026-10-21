import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  modelCode,
  rankSearch,
  searchForms,
  searchWords,
  type RankedSearch,
  type WordHit,
} from './lib/product-search-rules'

const HIT_SELECT = { id: true, isFeatured: true, publishedAt: true } satisfies Prisma.ProductSelect

/**
 * Free-text search over products: each word of the text is searched with the catalog's names for it (wifi →
 * "inalámbrica") and as a model code (L-3250 → "L3250"), then the products are ranked by how well they match.
 */
@Injectable()
export class ProductSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether the text has anything to search for ("de la" has not). */
  hasWords(text: string): boolean {
    return searchWords(text).length > 0
  }

  /** Products within `where` that match `text`, best first. See `rankSearch` for `partial`. */
  async rank(text: string, where: Prisma.ProductWhereInput, partial: boolean): Promise<RankedSearch> {
    const words = searchWords(text)
    return rankSearch(await Promise.all(words.map(word => this.hits(word, where))), partial)
  }

  /** Products within `where` that match one word, telling whether it was in a strong field. */
  private async hits(word: string, where: Prisma.ProductWhereInput): Promise<WordHit[]> {
    const forms = searchForms(word).map(escapeLike)
    const code = modelCode(word)
    const codeIds = code ? await this.idsByCode(code) : []
    const strong: Prisma.ProductWhereInput[] = forms.flatMap(form => [
      { name: { contains: form } },
      { shortDescription: { contains: form } },
      { variants: { some: { sku: { contains: form }, deletedAt: null } } },
      { category: { name: { contains: form } } },
      { brand: { name: { contains: form } } },
      { tags: { some: { tag: { name: { contains: form }, deletedAt: null } } } },
    ])
    if (codeIds.length) strong.push({ id: { in: codeIds } })
    // Specifications hold what names leave out (Wi-Fi, dúplex, A3), so they count, but less than the name.
    const weak: Prisma.ProductWhereInput[] = forms.map(form => ({
      specifications: { some: { value: { contains: form }, deletedAt: null } },
    }))
    const [strongRows, weakRows] = await Promise.all([
      this.prisma.product.findMany({ where: { AND: [where, { OR: strong }] }, select: HIT_SELECT }),
      this.prisma.product.findMany({ where: { AND: [where, { OR: weak }] }, select: HIT_SELECT }),
    ])
    return [...strongRows.map(row => ({ ...row, strong: true })), ...weakRows.map(row => ({ ...row, strong: false }))]
  }

  /** Products whose name or a SKU, without separators, contains the code ("TM-T20IV" for "tmt20"). */
  private async idsByCode(code: string): Promise<number[]> {
    // The code is only [a-z0-9], so it needs no LIKE escaping.
    const pattern = `%${code}%`
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM Product
      WHERE deletedAt IS NULL AND LOWER(REGEXP_REPLACE(name, '[^[:alnum:]]', '')) LIKE ${pattern}
      UNION
      SELECT productId AS id FROM ProductVariant
      WHERE deletedAt IS NULL AND LOWER(REGEXP_REPLACE(sku, '[^[:alnum:]]', '')) LIKE ${pattern}`
    return rows.map(row => Number(row.id))
  }
}

/** `contains` becomes LIKE: escape % and _ so they are searched literally, not as wildcards. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&')
}
