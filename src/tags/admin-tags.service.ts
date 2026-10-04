import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { diffForAudit } from '../audit-logs/lib/audit-diff'
import type { AuditActor } from '../common/types/audit-actor'
import { claimSlug, slugify } from '../common/utils/slug'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTagDto } from './dto/create-tag.dto'
import { AdminTagResponseDto } from './dto/tag-response.dto'
import { UpdateTagDto } from './dto/update-tag.dto'
import { ADMIN_TAG_SELECT, TAG_ORDER, toAdminTag } from './lib/tag-select'

@Injectable()
export class AdminTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Every tag with how many products use it. A short, bounded list: no pagination. */
  async findAll(): Promise<AdminTagResponseDto[]> {
    const rows = await this.prisma.tag.findMany({
      where: { deletedAt: null },
      orderBy: TAG_ORDER,
      select: ADMIN_TAG_SELECT,
    })
    return rows.map(toAdminTag)
  }

  async findOne(id: number): Promise<AdminTagResponseDto> {
    const row = await this.prisma.tag.findFirst({ where: { id, deletedAt: null }, select: ADMIN_TAG_SELECT })
    if (!row) throw new NotFoundException(`Tag ${id} not found`)
    return toAdminTag(row)
  }

  async create(dto: CreateTagDto, actor: AuditActor): Promise<AdminTagResponseDto> {
    const group = dto.group ?? null
    const slug = dto.slug ?? slugify(group ? `${group} ${dto.name}` : dto.name)
    if (!slug) throw new BadRequestException('The name must contain letters or numbers')
    const restoreId = await claimSlug(slug, this.findSlugHolder, null)
    const data = { name: dto.name, slug, group }

    const id = await this.prisma.$transaction(async tx => {
      // An archived tag holding this slug is restored instead of breaking the unique constraint.
      const saved = restoreId
        ? await tx.tag.update({ where: { id: restoreId }, data: { ...data, deletedAt: null }, select: { id: true } })
        : await tx.tag.create({ data, select: { id: true } })
      await this.auditLogs.record(
        actor,
        { action: 'tag.create', entityType: 'Tag', entityId: saved.id, changes: diffForAudit(null, data) },
        tx,
      )
      return saved.id
    })
    return this.findOne(id)
  }

  async update(id: number, dto: UpdateTagDto, actor: AuditActor): Promise<AdminTagResponseDto> {
    const current = await this.prisma.tag.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, slug: true, group: true },
    })
    if (!current) throw new NotFoundException(`Tag ${id} not found`)
    if (dto.slug && dto.slug !== current.slug) await claimSlug(dto.slug, this.findSlugHolder, id)

    // PartialType lets `null` through; required columns only accept a value or "unchanged" (undefined).
    const data = { name: dto.name ?? undefined, slug: dto.slug ?? undefined, group: dto.group }
    const changes = diffForAudit(current, data)
    if (Object.keys(changes).length > 0) {
      await this.prisma.$transaction(async tx => {
        await tx.tag.update({ where: { id }, data })
        await this.auditLogs.record(actor, { action: 'tag.update', entityType: 'Tag', entityId: id, changes }, tx)
      })
    }
    return this.findOne(id)
  }

  /** Soft-deletes the tag and removes it from its products (ProductTag is a join table: real delete). */
  async archive(id: number, actor: AuditActor): Promise<void> {
    const tag = await this.prisma.tag.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
    if (!tag) throw new NotFoundException(`Tag ${id} not found`)

    await this.prisma.$transaction(async tx => {
      const unlinked = await tx.productTag.deleteMany({ where: { tagId: id } })
      await tx.tag.update({ where: { id }, data: { deletedAt: new Date() } })
      await this.auditLogs.record(
        actor,
        {
          action: 'tag.archive',
          entityType: 'Tag',
          entityId: id,
          changes: { productCount: { from: unlinked.count, to: 0 } },
        },
        tx,
      )
    })
  }

  private readonly findSlugHolder = (slug: string) =>
    this.prisma.tag.findUnique({ where: { slug }, select: { id: true, deletedAt: true } })
}
