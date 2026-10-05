import { Injectable, NotFoundException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { DataSource, ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminProductReader } from './admin-product.reader'
import type { AdminProductDetailDto } from './dto/admin/admin-product-response.dto'
import { copyCandidates, copyName } from './lib/admin-product-rules'

const SLUG_MAX = 220
const SKU_MAX = 60

const SOURCE_SELECT = {
  type: true,
  name: true,
  slug: true,
  brandId: true,
  categoryId: true,
  shortDescription: true,
  description: true,
  outOfStockBehavior: true,
  warrantyMonths: true,
  seoTitle: true,
  seoDescription: true,
  variants: {
    where: { deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      sku: true,
      name: true,
      optionValues: true,
      barcode: true,
      isDefault: true,
      isActive: true,
      saleUnit: true,
      unitsPerSaleUnit: true,
      weightGrams: true,
      lengthMm: true,
      widthMm: true,
      heightMm: true,
      isBulky: true,
      prices: {
        where: { deletedAt: null },
        select: { priceListId: true, amount: true, currency: true, compareAtAmount: true },
      },
    },
  },
  images: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { fileId: true, altText: true, variantId: true, sortOrder: true },
  },
  specifications: {
    where: { deletedAt: null },
    select: { groupName: true, name: true, value: true, sortOrder: true },
  },
  tags: { where: { tag: { deletedAt: null } }, select: { tagId: true } },
} satisfies Prisma.ProductSelect

/**
 * "Duplicar": a new draft with the same content, images (same files), specifications, tags, variants and prices.
 * New slug and SKUs get a "copia" suffix; Tango codes and stock are not copied (they belong to the original articles).
 */
@Injectable()
export class AdminProductDuplicatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminProductReader,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async duplicate(sourceId: number, actor: AuditActor): Promise<AdminProductDetailDto> {
    const source = await this.prisma.product.findFirst({
      where: { id: sourceId, deletedAt: null },
      select: SOURCE_SELECT,
    })
    if (!source) throw new NotFoundException(`Product ${sourceId} not found`)
    const slug = await this.freeSlug(source.slug)
    const skus = await this.freeSkus(source.variants.map(variant => variant.sku))

    const id = await this.prisma.$transaction(async tx => {
      const { variants, images, specifications, tags, ...fields } = source
      const product = await tx.product.create({
        data: { ...fields, name: copyName(source.name), slug, status: ProductStatus.DRAFT },
        select: { id: true },
      })
      const variantIds = new Map<number, number>()
      for (const [index, { id: oldId, prices, optionValues, ...variant }] of variants.entries()) {
        const created = await tx.productVariant.create({
          data: {
            ...variant,
            optionValues: optionValues ?? Prisma.DbNull,
            productId: product.id,
            sku: skus[index],
            source: DataSource.MANUAL,
            prices: { create: prices.map(price => ({ ...price, source: DataSource.MANUAL })) },
          },
          select: { id: true },
        })
        variantIds.set(oldId, created.id)
      }
      await tx.productImage.createMany({
        data: images.map(image => ({
          ...image,
          productId: product.id,
          variantId: image.variantId ? (variantIds.get(image.variantId) ?? null) : null,
        })),
      })
      await tx.productSpecification.createMany({
        data: specifications.map(spec => ({ ...spec, productId: product.id })),
      })
      await tx.productTag.createMany({ data: tags.map(({ tagId }) => ({ productId: product.id, tagId })) })
      await this.auditLogs.record(
        actor,
        {
          action: 'product.duplicate',
          entityType: 'Product',
          entityId: product.id,
          changes: { sourceId: { from: null, to: sourceId } },
        },
        tx,
      )
      return product.id
    })
    return this.reader.detail(id)
  }

  /** First "<slug>-copia[-n]" not used by any product, archived ones included (the index is unique). */
  private async freeSlug(slug: string): Promise<string> {
    const candidates = copyCandidates(slug, 'copia', SLUG_MAX)
    const taken = await this.prisma.product.findMany({ where: { slug: { in: candidates } }, select: { slug: true } })
    return this.firstFree(candidates, new Set(taken.map(row => row.slug)))
  }

  private async freeSkus(skus: string[]): Promise<string[]> {
    const candidatesBySku = skus.map(sku => copyCandidates(sku, 'COPIA', SKU_MAX))
    const taken = await this.prisma.productVariant.findMany({
      where: { sku: { in: candidatesBySku.flat() } },
      select: { sku: true },
    })
    const used = new Set(taken.map(row => row.sku))
    // Each new SKU is reserved before choosing the next one, so two variants never get the same copy SKU.
    return candidatesBySku.map(candidates => {
      const sku = this.firstFree(candidates, used)
      used.add(sku)
      return sku
    })
  }

  private firstFree(candidates: string[], taken: Set<string>): string {
    const free = candidates.find(candidate => !taken.has(candidate))
    // 20 copies of the same product is far beyond normal use; the unique index (409) still protects the data.
    return free ?? candidates[candidates.length - 1]
  }
}
