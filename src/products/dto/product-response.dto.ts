import { OutOfStockBehavior, SaleUnit } from '../../generated/prisma/enums'
import type { MoneyDto } from '../../pricing/pricing.service'

export type Availability = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
export type ProductBadge = 'OFFER' | 'NEW'

export class NamedRefDto {
  name: string
  slug: string
}

export class ProductImageDto {
  url: string
  alt: string
  /** Set when the image shows a specific variant (e.g. a color). */
  variantId: number | null
}

export class ProductSummaryDto {
  id: number
  slug: string
  name: string
  shortDescription: string | null
  brand: NamedRefDto | null
  category: NamedRefDto
  imageUrl: string | null
  /** Lowest price among the variants, for the buyer making the request. Null if no variant has a price. */
  price: MoneyDto | null
  compareAtPrice: MoneyDto | null
  badge: ProductBadge | null
  isFeatured: boolean
  availability: Availability
  outOfStockBehavior: OutOfStockBehavior
  variantCount: number
}

export class ProductVariantDto {
  id: number
  sku: string
  name: string | null
  /** Shape: { "Color": "Cyan" }. */
  optionValues: Record<string, string> | null
  isDefault: boolean
  saleUnit: SaleUnit
  unitsPerSaleUnit: number
  price: MoneyDto | null
  compareAtPrice: MoneyDto | null
  availability: Availability
}

export class SpecificationGroupDto {
  group: string | null
  items: { name: string; value: string }[]
}

export class ProductDetailDto extends ProductSummaryDto {
  description: string | null
  warrantyMonths: number | null
  seoTitle: string | null
  seoDescription: string | null
  /** Parent category, for breadcrumbs. */
  parentCategory: NamedRefDto | null
  images: ProductImageDto[]
  variants: ProductVariantDto[]
  specifications: SpecificationGroupDto[]
  tags: (NamedRefDto & { group: string | null })[]
  /** Machines this product works with (for inks, papers, parts). */
  compatibleWith: ProductSummaryDto[]
  /** Inks, papers and parts that work with this product (for machines). */
  compatibleConsumables: ProductSummaryDto[]
}

export class PaginatedProductsDto {
  items: ProductSummaryDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
