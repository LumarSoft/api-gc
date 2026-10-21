import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  CATEGORY_BONUS,
  closestTerm,
  fold,
  HIT_WEIGHT,
  modelCode,
  rankSearch,
  searchForms,
  searchWords,
  startsAWord,
  type RankedSearch,
  type WordHit,
} from './lib/product-search-rules'
import { ProductSearchVocabulary } from './product-search-vocabulary.service'

/** A ranked search and, when a misspelled word was corrected, the text actually searched ("ecotnak" → "ecotank"). */
export type SearchMatch = RankedSearch & { correctedQuery: string | null }

const HIT_SELECT = { id: true, isFeatured: true, publishedAt: true } satisfies Prisma.ProductSelect
const STRONG_SELECT = {
  ...HIT_SELECT,
  name: true,
  category: { select: { name: true, parent: { select: { name: true } } } },
} satisfies Prisma.ProductSelect
type StrongRow = Prisma.ProductGetPayload<{ select: typeof STRONG_SELECT }>

/**
 * Free-text search over products: each word of the text is searched with the catalog's names for it (wifi →
 * "inalámbrica") and as a model code (L-3250 → "L3250"), then the products are ranked by how well they match.
 */
@Injectable()
export class ProductSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vocabulary: ProductSearchVocabulary,
  ) {}

  /** Whether the text has anything to search for ("de la" has not). */
  hasWords(text: string): boolean {
    return searchWords(text).length > 0
  }

  /**
   * Products within `where` that match `text`, best first. See `rankSearch` for `partial`. A word that finds nothing is
   * searched again as the catalog word it most likely misspells.
   */
  async rank(text: string, where: Prisma.ProductWhereInput, partial: boolean): Promise<SearchMatch> {
    const words = searchWords(text)
    const hits = await Promise.all(words.map(word => this.hits(word, where)))
    const searched = [...words]
    if (hits.some(found => !found.length)) {
      const vocabulary = await this.vocabulary.get()
      await Promise.all(
        words.map(async (word, index) => {
          const correction = hits[index].length || modelCode(word) ? null : closestTerm(word, vocabulary)
          if (!correction) return
          const corrected = await this.hits(correction, where)
          if (!corrected.length) return
          hits[index] = corrected
          searched[index] = correction
        }),
      )
    }
    const corrected = searched.some((word, index) => word !== words[index])
    return { ...rankSearch(hits, partial), correctedQuery: corrected ? searched.join(' ') : null }
  }

  /** Products within `where` that match one word, weighted by where it was found (`HIT_WEIGHT`, `CATEGORY_BONUS`). */
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
    // Specifications hold what names leave out (Wi-Fi, dúplex, A3), so they count, but less than the name. Links to
    // spec sheets are left out: their hashes would match short words like "a3" by chance.
    const weak: Prisma.ProductWhereInput[] = forms.map(form => ({
      specifications: {
        some: { value: { contains: form }, NOT: { value: { startsWith: 'http' } }, deletedAt: null },
      },
    }))
    const [strongRows, weakRows] = await Promise.all([
      this.prisma.product.findMany({ where: { AND: [where, { OR: strong }] }, select: STRONG_SELECT }),
      this.prisma.product.findMany({ where: { AND: [where, { OR: weak }] }, select: HIT_SELECT }),
    ])
    // Which strong matches are in the name (or a SKU / model code), and which are what their category names: the
    // collation ignores accents, so compare folded.
    const plainForms = searchForms(word)
    const foldedForms = plainForms.map(fold)
    const inName = (row: StrongRow): boolean =>
      codeIds.includes(row.id) || foldedForms.some(form => fold(row.name.toLowerCase()).includes(form))
    const inCategory = ({ category }: StrongRow): boolean =>
      startsAWord(category.name, plainForms) ||
      (category.parent !== null && startsAWord(category.parent.name, plainForms))
    const weight = (row: StrongRow): number =>
      (inName(row) ? HIT_WEIGHT.name : HIT_WEIGHT.related) + (inCategory(row) ? CATEGORY_BONUS : 0)
    return [
      ...strongRows.map(row => ({
        id: row.id,
        isFeatured: row.isFeatured,
        publishedAt: row.publishedAt,
        weight: weight(row),
      })),
      ...weakRows.map(row => ({ ...row, weight: HIT_WEIGHT.specification })),
    ]
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
