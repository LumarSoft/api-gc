import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { diffForAudit } from '../audit-logs/lib/audit-diff'
import type { AuditActor } from '../common/types/audit-actor'
import { claimSlug, slugify } from '../common/utils/slug'
import { Prisma } from '../generated/prisma/client'
import { DataSource, ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminProductMapper } from './admin-product.mapper'
import { AdminProductReader } from './admin-product.reader'
import type { AdminProductDetailDto, PaginatedAdminProductsDto } from './dto/admin/admin-product-response.dto'
import { CreateProductDto } from './dto/admin/create-product.dto'
import { ListAdminProductsQueryDto } from './dto/admin/list-admin-products-query.dto'
import { UpdateProductDto } from './dto/admin/update-product.dto'
import { adminListSelect } from './lib/admin-product-selects'
import { adminProductsOrderBy, adminProductsWhere } from './lib/admin-product-filters'
import { publishBlockerMessage } from './lib/admin-product-rules'

/** Admin catalog: list, create, edit, publish/hide and archive products. */
@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminProductReader,
    private readonly mapper: AdminProductMapper,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: ListAdminProductsQueryDto): Promise<PaginatedAdminProductsDto> {
    const where = adminProductsWhere(query, this.prisma.inventoryLevel.fields.reserved)
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: adminListSelect(await this.reader.retailListId()),
        orderBy: adminProductsOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ])
    return {
      items: rows.map(row => this.mapper.toListItem(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  findOne(id: number): Promise<AdminProductDetailDto> {
    return this.reader.detail(id)
  }

  async create(dto: CreateProductDto, actor: AuditActor): Promise<AdminProductDetailDto> {
    const slug = dto.slug ?? slugify(dto.name)
    if (!slug) throw new BadRequestException('The name must contain letters or numbers')
    await this.assertCategory(dto.categoryId)
    if (dto.brandId) await this.assertBrand(dto.brandId)
    if (await this.prisma.productVariant.count({ where: { sku: dto.sku } })) {
      throw new ConflictException(`The SKU "${dto.sku}" is already in use`)
    }
    const restoreId = await claimSlug(slug, this.findSlugHolder, null)

    const data = {
      name: dto.name,
      slug,
      categoryId: dto.categoryId,
      brandId: dto.brandId ?? null,
      shortDescription: dto.shortDescription ?? null,
      status: ProductStatus.DRAFT,
    }
    const id = await this.prisma.$transaction(async tx => {
      // An archived product holding this slug is restored as a fresh draft instead of breaking the unique index.
      const product = restoreId
        ? await tx.product.update({
            where: { id: restoreId },
            data: { ...data, deletedAt: null, publishedAt: null },
            select: { id: true },
          })
        : await tx.product.create({ data, select: { id: true } })
      await tx.productVariant.create({
        data: { productId: product.id, sku: dto.sku, isDefault: true, isActive: true, source: DataSource.MANUAL },
      })
      await this.auditLogs.record(
        actor,
        {
          action: 'product.create',
          entityType: 'Product',
          entityId: product.id,
          changes: diffForAudit(null, { ...data, sku: dto.sku }),
        },
        tx,
      )
      return product.id
    })
    return this.reader.detail(id)
  }

  async update(id: number, dto: UpdateProductDto, actor: AuditActor): Promise<AdminProductDetailDto> {
    const current = await this.prisma.product.findFirst({ where: { id, deletedAt: null } })
    if (!current) throw new NotFoundException(`Product ${id} not found`)
    if (dto.categoryId && dto.categoryId !== current.categoryId) await this.assertCategory(dto.categoryId)
    if (dto.brandId && dto.brandId !== current.brandId) await this.assertBrand(dto.brandId)
    if (dto.slug && dto.slug !== current.slug) await claimSlug(dto.slug, this.findSlugHolder, id)

    // Required columns only accept a value or "unchanged" (undefined), never null.
    const data: Prisma.ProductUncheckedUpdateInput = {
      ...dto,
      name: dto.name ?? undefined,
      slug: dto.slug ?? undefined,
      categoryId: dto.categoryId ?? undefined,
      isFeatured: dto.isFeatured ?? undefined,
      outOfStockBehavior: dto.outOfStockBehavior ?? undefined,
    }
    const changes = diffForAudit(current, data)
    if (Object.keys(changes).length > 0) {
      await this.prisma.$transaction(async tx => {
        await tx.product.update({ where: { id }, data })
        await this.auditLogs.record(
          actor,
          { action: 'product.update', entityType: 'Product', entityId: id, changes },
          tx,
        )
      })
    }
    return this.reader.detail(id)
  }

  /** Draft, published or hidden. Publishing requires an active variant with a retail price (see admin-product-rules). */
  async setStatus(id: number, status: ProductStatus, actor: AuditActor): Promise<AdminProductDetailDto> {
    const product = await this.reader.detail(id)
    if (product.status === status) return product
    if (status === ProductStatus.PUBLISHED) {
      const blocker = publishBlockerMessage(product.issues)
      if (blocker) throw new UnprocessableEntityException(blocker)
    }

    await this.prisma.$transaction(async tx => {
      await tx.product.update({
        where: { id },
        // The first publication date is kept: it drives the "Nuevo" badge and the "newest" sort.
        data: {
          status,
          publishedAt: status === ProductStatus.PUBLISHED ? (product.publishedAt ?? new Date()) : undefined,
        },
      })
      await this.auditLogs.record(
        actor,
        {
          action: 'product.status',
          entityType: 'Product',
          entityId: id,
          changes: { status: { from: product.status, to: status } },
        },
        tx,
      )
    })
    return this.reader.detail(id)
  }

  /** Soft delete. Orders keep their snapshot; the product disappears from the store and the admin list. */
  async archive(id: number, actor: AuditActor): Promise<void> {
    await this.reader.assertExists(id)
    await this.prisma.$transaction(async tx => {
      await tx.product.update({ where: { id }, data: { deletedAt: new Date() } })
      await this.auditLogs.record(actor, { action: 'product.archive', entityType: 'Product', entityId: id }, tx)
    })
  }

  private readonly findSlugHolder = (slug: string) =>
    this.prisma.product.findUnique({ where: { slug }, select: { id: true, deletedAt: true } })

  private async assertCategory(id: number): Promise<void> {
    const found = await this.prisma.category.count({ where: { id, deletedAt: null } })
    if (!found) throw new BadRequestException(`Category ${id} does not exist`)
  }

  private async assertBrand(id: number): Promise<void> {
    const found = await this.prisma.brand.count({ where: { id, deletedAt: null } })
    if (!found) throw new BadRequestException(`Brand ${id} does not exist`)
  }
}
