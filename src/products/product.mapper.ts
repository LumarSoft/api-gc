import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { ProductStatus } from '../generated/prisma/enums'
import type { PriceContext, ResolvedPrice } from '../pricing/pricing.service'
import { PricingService } from '../pricing/pricing.service'
import type { ProductDetailDto, ProductSummaryDto, ProductVariantDto } from './dto/product-response.dto'
import type { DetailRow, SummaryRow } from './lib/product-selects'
import { availabilityOf, badgeOf, bestAvailability, cheapest, groupSpecifications } from './lib/product-rules'

type RelatedRow = SummaryRow & { status: ProductStatus; deletedAt: Date | null }

/** Turns database rows into API responses: prices for the current buyer, public image URLs, stock and badges. */
@Injectable()
export class ProductMapper {
  constructor(
    private readonly pricing: PricingService,
    private readonly files: FilesService,
  ) {}

  toSummary(row: SummaryRow, context: PriceContext): ProductSummaryDto {
    const prices = row.variants
      .map(variant => this.pricing.resolve(variant.prices, context))
      .filter((resolved): resolved is ResolvedPrice => resolved !== null)
    const lowest = cheapest(prices)

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortDescription: row.shortDescription,
      brand: row.brand,
      category: row.category,
      imageUrl: row.images[0] ? this.files.publicUrl(row.images[0].file.storageKey) : null,
      price: lowest?.price ?? null,
      compareAtPrice: lowest?.compareAtPrice ?? null,
      badge: badgeOf(lowest, row.publishedAt),
      isFeatured: row.isFeatured,
      availability: bestAvailability(row.variants.map(variant => availabilityOf(variant.inventory))),
      outOfStockBehavior: row.outOfStockBehavior,
      variantCount: row.variants.length,
    }
  }

  toDetail(row: DetailRow, context: PriceContext): ProductDetailDto {
    return {
      ...this.toSummary(row, context),
      category: { name: row.category.name, slug: row.category.slug },
      parentCategory: row.category.parent,
      description: row.description,
      warrantyMonths: row.warrantyMonths,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      images: row.images.map(image => ({
        url: this.files.publicUrl(image.file.storageKey),
        alt: image.altText ?? row.name,
        variantId: image.variantId,
      })),
      variants: row.variants.map(variant => this.toVariant(variant, context)),
      specifications: groupSpecifications(row.specifications),
      tags: row.tags
        .filter(({ tag }) => tag.deletedAt === null)
        .map(({ tag }) => ({ name: tag.name, slug: tag.slug, group: tag.group })),
      compatibleWith: this.visibleSummaries(
        row.compatibleWith.map(({ targetProduct }) => targetProduct),
        context,
      ),
      compatibleConsumables: this.visibleSummaries(
        row.compatibleConsumables.map(({ product }) => product),
        context,
      ),
    }
  }

  private toVariant(variant: DetailRow['variants'][number], context: PriceContext): ProductVariantDto {
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
  }

  /** Related products are shown only while they are published and not deleted. */
  private visibleSummaries(rows: RelatedRow[], context: PriceContext): ProductSummaryDto[] {
    return rows
      .filter(row => row.status === ProductStatus.PUBLISHED && row.deletedAt === null)
      .map(row => this.toSummary(row, context))
  }
}
