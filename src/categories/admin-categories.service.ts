import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { diffForAudit } from '../audit-logs/lib/audit-diff'
import type { AuditActor } from '../common/types/audit-actor'
import { isSameSet } from '../common/utils/collections'
import { claimSlug, slugify } from '../common/utils/slug'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { AdminCategoryResponseDto } from './dto/admin-category-response.dto'
import { CreateCategoryDto } from './dto/create-category.dto'
import { UpdateCategoryDto } from './dto/update-category.dto'
import { archiveError, parentError } from './lib/category-rules'
import { ADMIN_CATEGORY_SELECT, buildCategoryTree } from './lib/category-tree'

const SORT = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }]

@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Every category, active or not, as a tree. The taxonomy is small and bounded: no pagination. */
  async findTree(): Promise<AdminCategoryResponseDto[]> {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: SORT,
      select: ADMIN_CATEGORY_SELECT,
    })
    return buildCategoryTree(rows, key => this.files.publicUrl(key))
  }

  async findOne(id: number): Promise<AdminCategoryResponseDto> {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null, OR: [{ id }, { parentId: id }] },
      orderBy: SORT,
      select: ADMIN_CATEGORY_SELECT,
    })
    const category = buildCategoryTree(rows, key => this.files.publicUrl(key)).find(node => node.id === id)
    if (!category) throw new NotFoundException(`Category ${id} not found`)
    return category
  }

  async create(dto: CreateCategoryDto, actor: AuditActor): Promise<AdminCategoryResponseDto> {
    const slug = this.slugFor(dto.slug, dto.name)
    const parentId = dto.parentId ?? null
    await this.assertParent({ id: null, hasChildren: false }, parentId)
    if (dto.imageFileId) await this.files.assertPublicImage(dto.imageFileId)
    const restoreId = await claimSlug(slug, this.findSlugHolder, null)

    const data = {
      name: dto.name,
      slug,
      parentId,
      description: dto.description ?? null,
      imageFileId: dto.imageFileId ?? null,
      isActive: dto.isActive ?? true,
      sortOrder: await this.nextSortOrder(parentId),
    }

    const id = await this.prisma.$transaction(async tx => {
      // An archived category holding this slug is restored instead of breaking the unique constraint.
      const saved = restoreId
        ? await tx.category.update({
            where: { id: restoreId },
            data: { ...data, deletedAt: null },
            select: { id: true },
          })
        : await tx.category.create({ data, select: { id: true } })
      await this.auditLogs.record(
        actor,
        { action: 'category.create', entityType: 'Category', entityId: saved.id, changes: diffForAudit(null, data) },
        tx,
      )
      return saved.id
    })
    return this.findOne(id)
  }

  async update(id: number, dto: UpdateCategoryDto, actor: AuditActor): Promise<AdminCategoryResponseDto> {
    const current = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: {
        name: true,
        slug: true,
        parentId: true,
        description: true,
        imageFileId: true,
        isActive: true,
        sortOrder: true,
        _count: { select: { children: { where: { deletedAt: null } } } },
      },
    })
    if (!current) throw new NotFoundException(`Category ${id} not found`)

    if (dto.parentId !== undefined) {
      await this.assertParent({ id, hasChildren: current._count.children > 0 }, dto.parentId)
    }
    if (dto.imageFileId) await this.files.assertPublicImage(dto.imageFileId)
    if (dto.slug && dto.slug !== current.slug) await claimSlug(dto.slug, this.findSlugHolder, id)

    const movesLevel = dto.parentId !== undefined && dto.parentId !== current.parentId
    // PartialType lets `null` through; required columns only accept a value or "unchanged" (undefined).
    const data = {
      name: dto.name ?? undefined,
      slug: dto.slug ?? undefined,
      parentId: dto.parentId,
      description: dto.description,
      imageFileId: dto.imageFileId,
      isActive: dto.isActive ?? undefined,
      // Moving to another level puts it last there, so it never shares a position with its new siblings.
      sortOrder: movesLevel ? await this.nextSortOrder(dto.parentId ?? null) : undefined,
    }
    const changes = diffForAudit(current, data)
    if (Object.keys(changes).length > 0) {
      await this.prisma.$transaction(async tx => {
        await tx.category.update({ where: { id }, data })
        await this.auditLogs.record(
          actor,
          { action: 'category.update', entityType: 'Category', entityId: id, changes },
          tx,
        )
      })
    }
    return this.findOne(id)
  }

  /** Sets the order of sibling categories: every top-level category, or every subcategory of one parent. */
  async reorder(ids: number[], actor: AuditActor): Promise<AdminCategoryResponseDto[]> {
    const first = await this.prisma.category.findFirst({
      where: { id: ids[0], deletedAt: null },
      select: { parentId: true },
    })
    const siblings = first
      ? await this.prisma.category.findMany({
          where: { parentId: first.parentId, deletedAt: null },
          select: { id: true },
        })
      : []
    if (
      !isSameSet(
        ids,
        siblings.map(row => row.id),
      )
    ) {
      throw new BadRequestException('Send every category of the same level, in the new order')
    }

    await this.prisma.$transaction(async tx => {
      for (const [sortOrder, id] of ids.entries()) {
        await tx.category.update({ where: { id }, data: { sortOrder } })
      }
      await this.auditLogs.record(
        actor,
        {
          action: 'category.reorder',
          entityType: 'Category',
          entityId: null,
          changes: { order: { from: null, to: ids } },
        },
        tx,
      )
    })
    return this.findTree()
  }

  /** Soft delete. Only empty categories can be archived, so no product is left without a category. */
  async archive(id: number, actor: AuditActor): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
      select: {
        _count: {
          select: { products: { where: { deletedAt: null } }, children: { where: { deletedAt: null } } },
        },
      },
    })
    if (!category) throw new NotFoundException(`Category ${id} not found`)
    const error = archiveError(category._count)
    if (error) throw new UnprocessableEntityException(error)

    await this.prisma.$transaction(async tx => {
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } })
      await this.auditLogs.record(actor, { action: 'category.archive', entityType: 'Category', entityId: id }, tx)
    })
  }

  private async nextSortOrder(parentId: number | null): Promise<number> {
    const last = await this.prisma.category.aggregate({
      where: { parentId, deletedAt: null },
      _max: { sortOrder: true },
    })
    return (last._max.sortOrder ?? -1) + 1
  }

  private slugFor(slug: string | undefined, name: string): string {
    const value = slug ?? slugify(name)
    if (!value) throw new BadRequestException('The name must contain letters or numbers')
    return value
  }

  private readonly findSlugHolder = (slug: string) =>
    this.prisma.category.findUnique({ where: { slug }, select: { id: true, deletedAt: true } })

  private async assertParent(
    node: { id: number | null; hasChildren: boolean },
    parentId: number | null,
  ): Promise<void> {
    if (parentId === null) return
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, deletedAt: null },
      select: { id: true, parentId: true },
    })
    if (!parent) throw new BadRequestException(`Parent category ${parentId} does not exist`)
    const error = parentError(node, parent)
    if (error) throw new BadRequestException(error)
  }
}
