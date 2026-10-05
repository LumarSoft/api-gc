import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import type {
  AdminProductDetailDto,
  AdminProductListItemDto,
  AdminVariantSummaryDto,
} from './dto/admin/admin-product-response.dto'
import { productIssues } from './lib/admin-product-rules'
import type { AdminDetailRow, AdminListRow, AdminVariantRow } from './lib/admin-product-selects'
import { availabilityOf, bestAvailability } from './lib/product-rules'

/** Admin view of products: stored prices (never converted), stock numbers and what each product still needs. */
@Injectable()
export class AdminProductMapper {
  constructor(private readonly files: FilesService) {}

  toListItem(row: AdminListRow): AdminProductListItemDto {
    const variants = row.variants.map(variant => this.toVariant(variant))
    const active = variants.filter(variant => variant.isActive)
    const main = variants[0]
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      imageUrl: row.images[0] ? this.files.publicUrl(row.images[0].file.storageKey) : null,
      category: row.category,
      brand: row.brand,
      sku: main?.sku ?? null,
      variantCount: variants.length,
      retailPrice: main?.retailPrice ?? variants.find(variant => variant.retailPrice)?.retailPrice ?? null,
      available: active.reduce((total, variant) => total + Math.max(0, variant.available ?? 0), 0),
      availability: bestAvailability(active.map(variant => variant.availability)),
      isFeatured: row.isFeatured,
      outOfStockBehavior: row.outOfStockBehavior,
      issues: this.issues(row._count.images, variants),
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
    }
  }

  toDetail(row: AdminDetailRow): AdminProductDetailDto {
    const variants = row.variants.map(variant => this.toVariant(variant))
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      name: row.name,
      slug: row.slug,
      categoryId: row.category.id,
      brandId: row.brand?.id ?? null,
      shortDescription: row.shortDescription,
      description: row.description,
      isFeatured: row.isFeatured,
      outOfStockBehavior: row.outOfStockBehavior,
      warrantyMonths: row.warrantyMonths,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      images: row.images.map(image => ({
        id: image.id,
        fileId: image.fileId,
        url: this.files.publicUrl(image.file.storageKey),
        altText: image.altText,
        variantId: image.variantId,
      })),
      specifications: row.specifications,
      tags: row.tags.map(({ tag }) => tag),
      variants,
      issues: this.issues(row._count.images, variants),
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private toVariant(variant: AdminVariantRow): AdminVariantSummaryDto {
    const price = variant.prices[0]
    return {
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      isDefault: variant.isDefault,
      isActive: variant.isActive,
      retailPrice: price ? { amount: price.amount.toFixed(2), currency: price.currency } : null,
      available: variant.inventory ? variant.inventory.onHand - variant.inventory.reserved : null,
      availability: availabilityOf(variant.inventory),
    }
  }

  private issues(imageCount: number, variants: AdminVariantSummaryDto[]): AdminProductListItemDto['issues'] {
    const activeVariants = variants
      .filter(variant => variant.isActive)
      .map(variant => ({ hasRetailPrice: variant.retailPrice !== null }))
    return productIssues({ imageCount, activeVariants })
  }
}
