import { Injectable } from '@nestjs/common'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { AuditChanges } from './lib/audit-diff'

export interface AuditEntry {
  /** `<entity>.<verb>`, e.g. "product.update", "file.upload". */
  action: string
  entityType: string
  entityId: number | null
  changes?: AuditChanges | null
}

/** Records who changed what from the admin panel. Rows are append-only (see docs/rules/database.md). */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the transaction client when the change runs in a transaction, so the log is written atomically with it. */
  async record(actor: AuditActor, entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma
    await client.auditLog.create({
      data: {
        userId: actor.userId,
        ipAddress: actor.ipAddress,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changes: entry.changes ?? Prisma.DbNull,
      },
    })
  }
}
