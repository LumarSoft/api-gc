import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { WholesaleStatus } from '../generated/prisma/enums'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import type { ListWholesaleApplicationsDto } from './dto/wholesale-application-input.dto'
import type {
  AdminWholesaleApplicationDto,
  WholesaleApplicationCountsDto,
  WholesaleApplicationsPageDto,
} from './dto/wholesale-application-response.dto'
import { applicationSearchWhere } from './lib/wholesale-application-search'
import { applicationSelect, type ApplicationRow } from './lib/wholesale-application-selects'
import { wholesaleDecisionMessage } from './lib/wholesale-emails'
import { decisionTarget, type WholesaleDecision } from './lib/wholesale-rules'
import { WholesaleApplicationMapper } from './wholesale-application.mapper'

/** Staff review of frequent-customer applications and the company's access (approve, reject, pause, resume). */
@Injectable()
export class AdminWholesaleApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: WholesaleApplicationMapper,
    private readonly audit: AuditLogsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async list(query: ListWholesaleApplicationsDto): Promise<WholesaleApplicationsPageDto> {
    const where: Prisma.WholesaleApplicationWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? applicationSearchWhere(query.q) : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.wholesaleApplication.findMany({
        where,
        select: applicationSelect,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.wholesaleApplication.count({ where }),
    ])
    const latest = await this.latestIds(rows)
    return {
      items: rows.map(row => this.mapper.admin(row, latest.has(row.id))),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  async counts(): Promise<WholesaleApplicationCountsDto> {
    const groups = await this.prisma.wholesaleApplication.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    })
    const counts = Object.fromEntries(
      Object.values(WholesaleStatus).map(status => [status, 0]),
    ) as WholesaleApplicationCountsDto
    for (const group of groups) counts[group.status] = group._count._all
    return counts
  }

  async read(id: number): Promise<AdminWholesaleApplicationDto> {
    const row = await this.prisma.wholesaleApplication.findFirst({
      where: { id, deletedAt: null },
      select: applicationSelect,
    })
    if (!row) throw new NotFoundException('Solicitud no encontrada.')
    return this.mapper.admin(row, (await this.latestIds([row])).has(row.id))
  }

  async decide(
    id: number,
    decision: WholesaleDecision,
    note: string | undefined,
    actor: AuditActor,
  ): Promise<AdminWholesaleApplicationDto> {
    if ((decision === 'reject' || decision === 'pause') && !note)
      throw new UnprocessableEntityException('Contale al cliente el motivo.')
    const result = await this.prisma.$transaction(async tx => {
      const application = await tx.wholesaleApplication.findFirst({
        where: { id, deletedAt: null },
        select: { companyId: true },
      })
      if (!application) throw new NotFoundException('Solicitud no encontrada.')
      // The company row is the source of truth for access: lock it so two staff decisions cannot interleave.
      await tx.$queryRaw`SELECT id FROM Company WHERE id = ${application.companyId} FOR UPDATE`
      const company = await tx.company.findUniqueOrThrow({
        where: { id: application.companyId },
        select: {
          wholesaleStatus: true,
          applications: { where: { deletedAt: null }, orderBy: { id: 'desc' }, take: 1, select: { id: true } },
        },
      })
      const target = decisionTarget(decision, company.wholesaleStatus)
      if (company.applications[0]?.id !== id || !target)
        throw new UnprocessableEntityException('Esta solicitud ya no admite ese cambio. Actualizá la página.')
      const now = new Date()
      await tx.company.update({
        where: { id: application.companyId },
        data: { wholesaleStatus: target, statusChangedAt: now },
      })
      const saved = await tx.wholesaleApplication.update({
        where: { id },
        data: { status: target, reviewedById: actor.userId, reviewedAt: now, reviewNote: note ?? null },
        select: applicationSelect,
      })
      await this.audit.record(
        actor,
        {
          action: `wholesale-application.${decision}`,
          entityType: 'WholesaleApplication',
          entityId: id,
          changes: { status: { from: company.wholesaleStatus, to: target } },
        },
        tx,
      )
      return saved
    })
    if (decision === 'approve' || decision === 'reject') await this.notify(result, decision === 'approve')
    return this.mapper.admin(result, true)
  }

  private async notify(row: ApplicationRow, approved: boolean): Promise<void> {
    const frontUrl = (this.config.get<string>('FRONT_URL') ?? 'http://localhost:3000').replace(/\/+$/, '')
    const accountUrl = `${frontUrl}/mi-cuenta`
    await this.mail.send(
      wholesaleDecisionMessage(
        { id: row.submittedBy.id, email: row.submittedBy.email, firstName: row.submittedBy.firstName },
        approved,
        row.reviewNote,
        accountUrl,
      ),
    )
  }

  /** Ids of the given applications that are the newest of their company (only those accept decisions). */
  private async latestIds(rows: ApplicationRow[]): Promise<Set<number>> {
    if (!rows.length) return new Set()
    const groups = await this.prisma.wholesaleApplication.groupBy({
      by: ['companyId'],
      where: { companyId: { in: [...new Set(rows.map(row => row.company.id))] }, deletedAt: null },
      _max: { id: true },
    })
    return new Set(groups.flatMap(group => (group._max.id ? [group._max.id] : [])))
  }
}
