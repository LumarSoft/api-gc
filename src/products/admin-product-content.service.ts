import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { hasRepeatedIds, planListSync } from '../common/utils/list-sync'
import { FileVisibility } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminProductReader } from './admin-product.reader'
import type { AdminProductDetailDto } from './dto/admin/admin-product-response.dto'
import type { ProductImageInputDto } from './dto/admin/replace-product-images.dto'
import type { SpecificationInputDto } from './dto/admin/replace-product-specifications.dto'

/** Gallery, technical sheet and tags of a product. Each one is saved as a whole, ordered list. */
@Injectable()
export class AdminProductContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminProductReader,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async replaceImages(
    productId: number,
    images: ProductImageInputDto[],
    actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    await this.reader.assertExists(productId)
    await this.assertImageFiles(images.map(image => image.fileId))
    await this.assertOwnVariants(
      productId,
      images.flatMap(image => (image.variantId ? [image.variantId] : [])),
    )
    const existing = await this.prisma.productImage.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, fileId: true },
    })
    const { removedIds } = this.plan(
      existing.map(row => row.id),
      images,
    )

    await this.prisma.$transaction(async tx => {
      await tx.productImage.updateMany({ where: { id: { in: removedIds } }, data: { deletedAt: new Date() } })
      for (const [sortOrder, image] of images.entries()) {
        const data = {
          fileId: image.fileId,
          altText: image.altText ?? null,
          variantId: image.variantId ?? null,
          sortOrder,
        }
        if (image.id) await tx.productImage.update({ where: { id: image.id }, data })
        else await tx.productImage.create({ data: { ...data, productId } })
      }
      await this.auditLogs.record(
        actor,
        {
          action: 'product.images',
          entityType: 'Product',
          entityId: productId,
          changes: { fileIds: { from: existing.map(row => row.fileId), to: images.map(image => image.fileId) } },
        },
        tx,
      )
    })
    return this.reader.detail(productId)
  }

  async replaceSpecifications(
    productId: number,
    specifications: SpecificationInputDto[],
    actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    await this.reader.assertExists(productId)
    const existing = await this.prisma.productSpecification.findMany({
      where: { productId, deletedAt: null },
      select: { id: true },
    })
    const { removedIds } = this.plan(
      existing.map(row => row.id),
      specifications,
    )

    await this.prisma.$transaction(async tx => {
      await tx.productSpecification.updateMany({ where: { id: { in: removedIds } }, data: { deletedAt: new Date() } })
      for (const [sortOrder, spec] of specifications.entries()) {
        const data = {
          groupName: spec.groupName?.trim() || null,
          name: spec.name.trim(),
          value: spec.value.trim(),
          sortOrder,
        }
        if (spec.id) await tx.productSpecification.update({ where: { id: spec.id }, data })
        else await tx.productSpecification.create({ data: { ...data, productId } })
      }
      await this.auditLogs.record(
        actor,
        {
          action: 'product.specifications',
          entityType: 'Product',
          entityId: productId,
          changes: { count: { from: existing.length, to: specifications.length } },
        },
        tx,
      )
    })
    return this.reader.detail(productId)
  }

  async replaceTags(productId: number, tagIds: number[], actor: AuditActor): Promise<AdminProductDetailDto> {
    await this.reader.assertExists(productId)
    const found = await this.prisma.tag.count({ where: { id: { in: tagIds }, deletedAt: null } })
    if (found !== tagIds.length) throw new BadRequestException('Some tags do not exist')
    const current = await this.prisma.productTag.findMany({ where: { productId }, select: { tagId: true } })

    await this.prisma.$transaction(async tx => {
      // ProductTag is a pure join table: unlinking is a real delete (docs/rules/database.md).
      await tx.productTag.deleteMany({ where: { productId, tagId: { notIn: tagIds } } })
      await tx.productTag.createMany({ data: tagIds.map(tagId => ({ productId, tagId })), skipDuplicates: true })
      await this.auditLogs.record(
        actor,
        {
          action: 'product.tags',
          entityType: 'Product',
          entityId: productId,
          changes: { tagIds: { from: current.map(row => row.tagId), to: tagIds } },
        },
        tx,
      )
    })
    return this.reader.detail(productId)
  }

  /** Rows the client kept must be this product's own rows, each at most once. */
  private plan(existingIds: number[], items: { id?: number }[]): { removedIds: number[] } {
    const { removedIds, unknownIds } = planListSync(existingIds, items)
    if (unknownIds.length > 0 || hasRepeatedIds(items)) {
      throw new BadRequestException('The list contains rows that do not belong to this product')
    }
    return { removedIds }
  }

  private async assertImageFiles(fileIds: number[]): Promise<void> {
    const unique = [...new Set(fileIds)]
    const found = await this.prisma.storedFile.count({
      where: {
        id: { in: unique },
        visibility: FileVisibility.PUBLIC,
        deletedAt: null,
        mimeType: { startsWith: 'image/' },
      },
    })
    if (found !== unique.length) throw new BadRequestException('Some images do not exist')
  }

  private async assertOwnVariants(productId: number, variantIds: number[]): Promise<void> {
    const unique = [...new Set(variantIds)]
    const found = await this.prisma.productVariant.count({ where: { id: { in: unique }, productId, deletedAt: null } })
    if (found !== unique.length) throw new BadRequestException('Some variants do not belong to this product')
  }
}
