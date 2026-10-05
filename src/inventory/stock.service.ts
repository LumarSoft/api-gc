import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { StockBucket, StockMovementReason } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { adjustmentDelta, onHandError } from './lib/stock-rules'

export interface StockAdjustment {
  /** New physical quantity (what was counted). */
  onHand: number
  /** Undefined = unchanged, null = store default. */
  lowStockThreshold?: number | null
  note?: string | null
}

/**
 * Stock levels. Every change is a StockMovement row in the same transaction as the level (docs/rules/business-rules.md).
 *
 * TODO(tango): the manual adjustment is PROVISIONAL. Stock must come from Tango once the integration method is
 * defined (movements with reason TANGO_SYNC); then decide whether manual adjustments stay (e.g. for store-only items).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async adjust(variantId: number, adjustment: StockAdjustment, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const level = await tx.inventoryLevel.findUnique({
        where: { variantId },
        select: { onHand: true, reserved: true, lowStockThreshold: true },
      })
      const current = level ?? { onHand: 0, reserved: 0, lowStockThreshold: null }
      const error = onHandError(adjustment.onHand, current.reserved)
      if (error) throw new UnprocessableEntityException(error)

      const delta = adjustmentDelta(current.onHand, adjustment.onHand)
      const lowStockThreshold =
        adjustment.lowStockThreshold === undefined ? current.lowStockThreshold : adjustment.lowStockThreshold
      await tx.inventoryLevel.upsert({
        where: { variantId },
        create: { variantId, onHand: adjustment.onHand, lowStockThreshold },
        update: { onHand: adjustment.onHand, lowStockThreshold },
      })
      if (delta !== 0) {
        await tx.stockMovement.create({
          data: {
            variantId,
            bucket: StockBucket.ON_HAND,
            quantity: delta,
            reason: StockMovementReason.ADJUSTMENT,
            note: adjustment.note?.trim() || 'Ajuste manual desde el panel',
            createdById: actor.userId,
          },
        })
      }
      await this.auditLogs.record(
        actor,
        {
          action: 'stock.adjust',
          entityType: 'ProductVariant',
          entityId: variantId,
          changes: {
            onHand: { from: current.onHand, to: adjustment.onHand },
            lowStockThreshold: { from: current.lowStockThreshold, to: lowStockThreshold },
          },
        },
        tx,
      )
    })
  }
}
