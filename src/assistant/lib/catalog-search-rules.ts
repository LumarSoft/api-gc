import type { MoneyDto } from '../../pricing/pricing.service'
import type { Availability, ProductDetailDto, ProductSummaryDto } from '../../products/dto/product-response.dto'

/** Words that say nothing about the product ("una impresora para la oficina" → "impresora", "oficina"). */
const STOP_WORDS = new Set([
  ...'a al algo alguna alguno busco con como cual de del el en es esa ese esta este la las lo los'.split(' '),
  ...'me mi mis necesito o para por que quiero se su sus tiene un una uno unos unas y'.split(' '),
])
/** Searched words are few: more would only narrow the results to nothing. */
const MAX_WORDS = 5
const DESCRIPTION_CHARS = 1200
const MAX_SPECIFICATIONS = 40

/**
 * Words to look for in a free-text search, without stop words and in singular ("impresoras fotográficas" →
 * "impresora", "fotográfica"). The database collation already ignores case and accents.
 */
export function searchWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word))
    .map(singular)
  return [...new Set(words)].slice(0, MAX_WORDS)
}

function singular(word: string): string {
  if (word.length > 4 && /[^aeiou]es$/.test(word) && !/(as|es|is|os|us)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && /[aeiou]s$/.test(word)) return word.slice(0, -1)
  return word
}

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const USD = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** "$ 419.999", as the store shows it. USD only when no exchange rate is loaded. */
export function priceLabel(money: MoneyDto | null): string | null {
  if (!money) return null
  return (money.currency === 'USD' ? USD : ARS).format(Number(money.amount))
}

const AVAILABILITY_LABELS: Record<Availability, string> = {
  IN_STOCK: 'en stock',
  LOW_STOCK: 'pocas unidades',
  OUT_OF_STOCK: 'sin stock',
}

/** Whether a price is within the customer's budget. Products without an ARS price never are. */
export function withinBudget(price: MoneyDto | null, maxPrice: number | null): boolean {
  if (maxPrice === null) return true
  return price?.currency === 'ARS' && Number(price.amount) <= maxPrice
}

/** What the model reads about a product in a list: enough to choose, not the whole sheet. */
export function productLine(product: ProductSummaryDto) {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category.name,
    summary: product.shortDescription,
    price: priceLabel(product.price) ?? 'sin precio publicado',
    ...(product.badge === 'OFFER' ? { previousPrice: priceLabel(product.compareAtPrice) } : {}),
    availability: AVAILABILITY_LABELS[product.availability],
    ...(product.variantCount > 1 ? { options: product.variantCount } : {}),
  }
}

/** The product sheet for the model. Links (PDFs, manuals) are left out: the assistant only links to the store. */
export function productSheet(product: ProductDetailDto) {
  const specifications = product.specifications
    .flatMap(group => group.items.map(item => ({ group: group.group, ...item })))
    .filter(item => !/^https?:\/\//i.test(item.value))
    .slice(0, MAX_SPECIFICATIONS)
    .map(item => `${item.group ? `${item.group} · ` : ''}${item.name}: ${item.value}`)
  return {
    ...productLine(product),
    brand: product.brand?.name ?? null,
    description: product.description ? truncate(product.description, DESCRIPTION_CHARS) : null,
    warrantyMonths: product.warrantyMonths,
    uses: product.tags.map(tag => tag.name),
    options: product.variants.map(variant => ({
      name: variant.name ?? (Object.values(variant.optionValues ?? {}).join(' / ') || variant.sku),
      sku: variant.sku,
      price: priceLabel(variant.price) ?? 'sin precio publicado',
      availability: AVAILABILITY_LABELS[variant.availability],
    })),
    specifications,
    compatibleWith: product.compatibleWith.map(related => ({ slug: related.slug, name: related.name })),
    compatibleConsumables: product.compatibleConsumables.map(related => ({ slug: related.slug, name: related.name })),
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}…`
}
