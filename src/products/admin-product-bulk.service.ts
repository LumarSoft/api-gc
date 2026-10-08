import { Injectable } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminProductMapper } from './admin-product.mapper'
import { AdminProductReader } from './admin-product.reader'
import type { BulkProductsDto, BulkProductsResultDto } from './dto/admin/bulk-products.dto'
import { adminListSelect } from './lib/admin-product-selects'
import { planBulkAction } from './lib/bulk-product-rules'

/** Publish, hide, draft or archive several products at once, with one audit entry per product. */
@Injectable()
export class AdminProductBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminProductReader,
    private readonly mapper: AdminProductMapper,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async apply({ ids, action }: BulkProductsDto, actor: AuditActor): Promise<BulkProductsResultDto> {
    const retailListId = await this.reader.retailListId()
    return this.prisma.$transaction(
      async tx => {
        // Lock the rows so a concurrent edit or a second bulk request cannot interleave with this plan.
        await tx.$queryRaw`SELECT id FROM Product WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`
        const rows = await tx.product.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: adminListSelect(retailListId),
        })
        const plan = planBulkAction(
          ids,
          rows.map(row => this.mapper.toListItem(row)),
          action,
        )
        const publishedAt = new Map(rows.map(row => [row.id, row.publishedAt]))

        for (const change of plan.changes) {
          if (change.to === null) {
            await tx.product.update({ where: { id: change.id }, data: { deletedAt: new Date() } })
            await this.auditLogs.record(
              actor,
              { action: 'product.archive', entityType: 'Product', entityId: change.id },
              tx,
            )
            continue
          }
          await tx.product.update({
            where: { id: change.id },
            // Same as the single change: the first publication date is kept ("Nuevo" badge, "newest" sort).
            data: {
              status: change.to,
              publishedAt:
                change.to === ProductStatus.PUBLISHED ? (publishedAt.get(change.id) ?? new Date()) : undefined,
            },
          })
          await this.auditLogs.record(
            actor,
            {
              action: 'product.status',
              entityType: 'Product',
              entityId: change.id,
              changes: { status: { from: change.from, to: change.to } },
            },
            tx,
          )
        }
        return { updated: plan.changes.map(change => change.id), unchanged: plan.unchanged, skipped: plan.skipped }
      },
      // Up to 100 products with their audit rows: more than the 5 s default on a remote database.
      { timeout: 20_000 },
    )
  }
}
