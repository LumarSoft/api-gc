import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { SystemLogLevel } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ListSystemLogsDto } from './dto/system-list-query.dto'
import type { SystemLogsPageDto } from './dto/system-list-response.dto'
import type { SystemStatusDto } from './dto/system-status.dto'

const DAY_MS = 24 * 60 * 60 * 1000

/** Reads the errors and warnings the API kept (`SystemLog`) for the developers' page. */
@Injectable()
export class SystemLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSystemLogsDto): Promise<SystemLogsPageDto> {
    const where: Prisma.SystemLogWhereInput = {
      level: query.level,
      source: query.source,
      ...(query.q && { OR: [{ message: { contains: query.q } }, { route: { contains: query.q } }] }),
    }
    const [rows, total, sources] = await Promise.all([
      this.prisma.systemLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.systemLog.count({ where }),
      this.prisma.systemLog.groupBy({ by: ['source'], _sum: { count: true }, orderBy: { source: 'asc' } }),
    ])
    return {
      items: rows.map(row => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      sources: sources.map(row => ({ source: row.source, count: row._sum.count ?? 0 })),
    }
  }

  /** Errors and warnings of the last 24 hours (repeats included), for the status summary. */
  async summary(now = new Date()): Promise<SystemStatusDto['logs']> {
    const since = new Date(now.getTime() - DAY_MS)
    const [byLevel, lastError] = await Promise.all([
      this.prisma.systemLog.groupBy({ by: ['level'], where: { lastSeenAt: { gte: since } }, _sum: { count: true } }),
      this.prisma.systemLog.findFirst({
        where: { level: SystemLogLevel.ERROR },
        orderBy: { lastSeenAt: 'desc' },
        select: { lastSeenAt: true, source: true, message: true },
      }),
    ])
    const sum = (level: SystemLogLevel): number => byLevel.find(row => row.level === level)?._sum.count ?? 0
    return {
      last24h: { errors: sum(SystemLogLevel.ERROR), warnings: sum(SystemLogLevel.WARN) },
      lastError: lastError
        ? { at: lastError.lastSeenAt.toISOString(), source: lastError.source, message: lastError.message.slice(0, 300) }
        : null,
    }
  }
}
