import { Injectable } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { ListSystemActivityDto } from './dto/system-list-query.dto'
import type { SystemActivityPageDto } from './dto/system-list-response.dto'

const USER_SELECT = { id: true, firstName: true, lastName: true, email: true } satisfies Prisma.UserSelect
type AuditUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>

/** What staff changed in the admin (`AuditLog`, recorded since the panel exists), for the developers' page. */
@Injectable()
export class SystemActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListSystemActivityDto): Promise<SystemActivityPageDto> {
    const where: Prisma.AuditLogWhereInput = { userId: query.userId, entityType: query.entityType }
    const [rows, total, userIds, entityTypes] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: USER_SELECT } },
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.groupBy({ by: ['userId'], where: { userId: { not: null } } }),
      this.prisma.auditLog.groupBy({ by: ['entityType'], orderBy: { entityType: 'asc' } }),
    ])
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds.flatMap(row => (row.userId === null ? [] : [row.userId])) } },
      select: USER_SELECT,
      orderBy: { firstName: 'asc' },
    })
    return {
      items: rows.map(row => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        changes: row.changes,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
        user: row.user ? person(row.user) : null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      users: users.map(user => ({ id: user.id, name: person(user).name })),
      entityTypes: entityTypes.map(row => row.entityType),
    }
  }
}

function person(user: AuditUser): { id: number; name: string; email: string } {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return { id: user.id, name: name || user.email, email: user.email }
}
