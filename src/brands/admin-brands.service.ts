import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { diffForAudit } from '../audit-logs/lib/audit-diff'
import type { AuditActor } from '../common/types/audit-actor'
import { isSameSet } from '../common/utils/collections'
import { claimSlug, slugify } from '../common/utils/slug'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { AdminBrandResponseDto } from './dto/admin-brand-response.dto'
import { CreateBrandDto } from './dto/create-brand.dto'
import { UpdateBrandDto } from './dto/update-brand.dto'
import { ADMIN_BRAND_SELECT, toAdminBrand } from './lib/admin-brand-select'

@Injectable()
export class AdminBrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Every brand, active or not. A short, bounded list: no pagination. */
  async findAll(): Promise<AdminBrandResponseDto[]> {
    const rows = await this.prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: ADMIN_BRAND_SELECT,
    })
    return rows.map(row => toAdminBrand(row, key => this.files.publicUrl(key)))
  }

  async findOne(id: number): Promise<AdminBrandResponseDto> {
    const row = await this.prisma.brand.findFirst({ where: { id, deletedAt: null }, select: ADMIN_BRAND_SELECT })
    if (!row) throw new NotFoundException(`Brand ${id} not found`)
    return toAdminBrand(row, key => this.files.publicUrl(key))
  }

  async create(dto: CreateBrandDto, actor: AuditActor): Promise<AdminBrandResponseDto> {
    const slug = dto.slug ?? slugify(dto.name)
    if (!slug) throw new BadRequestException('The name must contain letters or numbers')
    if (dto.logoFileId) await this.files.assertPublicImage(dto.logoFileId)
    const restoreId = await claimSlug(slug, this.findSlugHolder, null)

    const last = await this.prisma.brand.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } })
    const data = {
      name: dto.name,
      slug,
      logoFileId: dto.logoFileId ?? null,
      isActive: dto.isActive ?? true,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    }

    const id = await this.prisma.$transaction(async tx => {
      // An archived brand holding this slug is restored instead of breaking the unique constraint.
      const saved = restoreId
        ? await tx.brand.update({ where: { id: restoreId }, data: { ...data, deletedAt: null }, select: { id: true } })
        : await tx.brand.create({ data, select: { id: true } })
      await this.auditLogs.record(
        actor,
        { action: 'brand.create', entityType: 'Brand', entityId: saved.id, changes: diffForAudit(null, data) },
        tx,
      )
      return saved.id
    })
    return this.findOne(id)
  }

  async update(id: number, dto: UpdateBrandDto, actor: AuditActor): Promise<AdminBrandResponseDto> {
    const current = await this.prisma.brand.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, slug: true, logoFileId: true, isActive: true },
    })
    if (!current) throw new NotFoundException(`Brand ${id} not found`)
    if (dto.logoFileId) await this.files.assertPublicImage(dto.logoFileId)
    if (dto.slug && dto.slug !== current.slug) await claimSlug(dto.slug, this.findSlugHolder, id)

    // PartialType lets `null` through; required columns only accept a value or "unchanged" (undefined).
    const data = {
      name: dto.name ?? undefined,
      slug: dto.slug ?? undefined,
      logoFileId: dto.logoFileId,
      isActive: dto.isActive ?? undefined,
    }
    const changes = diffForAudit(current, data)
    if (Object.keys(changes).length > 0) {
      await this.prisma.$transaction(async tx => {
        await tx.brand.update({ where: { id }, data })
        await this.auditLogs.record(actor, { action: 'brand.update', entityType: 'Brand', entityId: id, changes }, tx)
      })
    }
    return this.findOne(id)
  }

  /** Sets the order of every brand at once, so two brands never share a position. */
  async reorder(ids: number[], actor: AuditActor): Promise<AdminBrandResponseDto[]> {
    const brands = await this.prisma.brand.findMany({ where: { deletedAt: null }, select: { id: true } })
    if (
      !isSameSet(
        ids,
        brands.map(brand => brand.id),
      )
    ) {
      throw new BadRequestException('Send every brand, in the new order')
    }

    await this.prisma.$transaction(async tx => {
      for (const [sortOrder, id] of ids.entries()) {
        await tx.brand.update({ where: { id }, data: { sortOrder } })
      }
      await this.auditLogs.record(
        actor,
        { action: 'brand.reorder', entityType: 'Brand', entityId: null, changes: { order: { from: null, to: ids } } },
        tx,
      )
    })
    return this.findAll()
  }

  /** Soft delete. A brand with products is deactivated instead, so no product loses its brand by accident. */
  async archive(id: number, actor: AuditActor): Promise<void> {
    const brand = await this.prisma.brand.findFirst({
      where: { id, deletedAt: null },
      select: { _count: { select: { products: { where: { deletedAt: null } } } } },
    })
    if (!brand) throw new NotFoundException(`Brand ${id} not found`)
    if (brand._count.products > 0) {
      throw new UnprocessableEntityException('Move its products to another brand first, or deactivate it')
    }

    await this.prisma.$transaction(async tx => {
      await tx.brand.update({ where: { id }, data: { deletedAt: new Date() } })
      await this.auditLogs.record(actor, { action: 'brand.archive', entityType: 'Brand', entityId: id }, tx)
    })
  }

  private readonly findSlugHolder = (slug: string) =>
    this.prisma.brand.findUnique({ where: { slug }, select: { id: true, deletedAt: true } })
}
