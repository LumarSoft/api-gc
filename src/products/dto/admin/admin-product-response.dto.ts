import { Currency, OutOfStockBehavior, ProductStatus, ProductType } from '../../../generated/prisma/enums'
import type { ProductIssue } from '../../lib/admin-product-rules'
import type { Availability } from '../product-response.dto'

export class IdNameDto {
  id: number
  name: string
}

/** A price exactly as loaded (not converted): amount as a decimal string and its currency. */
export class StoredPriceDto {
  amount: string
  currency: Currency
}

export class AdminVariantSummaryDto {
  id: number
  sku: string
  name: string | null
  isDefault: boolean
  isActive: boolean
  /** Price in the default retail list, or null when it has none. */
  retailPrice: StoredPriceDto | null
  /** On hand minus reserved. Null when stock was never loaded. */
  available: number | null
  availability: Availability
}

export class AdminProductListItemDto {
  id: number
  name: string
  slug: string
  status: ProductStatus
  imageUrl: string | null
  category: IdNameDto
  brand: IdNameDto | null
  /** SKU of the default variant (or the first one). */
  sku: string | null
  variantCount: number
  /** Retail price of the default variant (or the first one that has one). */
  retailPrice: StoredPriceDto | null
  /** Sum of available units across active variants. */
  available: number
  availability: Availability
  isFeatured: boolean
  outOfStockBehavior: OutOfStockBehavior
  issues: ProductIssue[]
  publishedAt: Date | null
  updatedAt: Date
}

export class PaginatedAdminProductsDto {
  items: AdminProductListItemDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export class AdminProductImageDto {
  id: number
  fileId: number
  url: string
  altText: string | null
  variantId: number | null
}

export class AdminSpecificationDto {
  id: number
  groupName: string | null
  name: string
  value: string
}

export class AdminProductTagDto {
  id: number
  name: string
  slug: string
  group: string | null
}

export class AdminProductDetailDto {
  id: number
  type: ProductType
  status: ProductStatus
  name: string
  slug: string
  categoryId: number
  brandId: number | null
  shortDescription: string | null
  description: string | null
  isFeatured: boolean
  outOfStockBehavior: OutOfStockBehavior
  warrantyMonths: number | null
  seoTitle: string | null
  seoDescription: string | null
  images: AdminProductImageDto[]
  specifications: AdminSpecificationDto[]
  tags: AdminProductTagDto[]
  variants: AdminVariantSummaryDto[]
  issues: ProductIssue[]
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
