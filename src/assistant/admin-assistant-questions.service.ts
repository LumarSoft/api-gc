import { Injectable, NotFoundException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma } from '../generated/prisma/client'
import { QuestionStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminAssistantMapper } from './admin-assistant.mapper'
import type { ChangeQuestionStatusDto, ListUnansweredQuestionsDto } from './dto/admin-assistant-input.dto'
import type {
  QuestionStatusResultDto,
  UnansweredQuestionCountsDto,
  UnansweredQuestionsPageDto,
} from './dto/admin-assistant-response.dto'
import { questionSearchWhere } from './lib/admin-assistant-search'
import { questionSelect } from './lib/admin-assistant-selects'

/** Audit verb of each target status. */
const AUDIT_VERB: Record<QuestionStatus, string> = {
  [QuestionStatus.ANSWERED]: 'answer',
  [QuestionStatus.DISMISSED]: 'dismiss',
  [QuestionStatus.OPEN]: 'reopen',
}

/**
 * Questions the assistant could not answer. Staff complete the missing data where it belongs (product sheet,
 * catalog…) and mark the question answered, or dismiss it; the assistant does not read these rows.
 */
@Injectable()
export class AdminAssistantQuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: AdminAssistantMapper,
    private readonly audit: AuditLogsService,
  ) {}

  /** Newest first. */
  async list(query: ListUnansweredQuestionsDto): Promise<UnansweredQuestionsPageDto> {
    const where: Prisma.UnansweredQuestionWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? questionSearchWhere(query.q) : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.unansweredQuestion.findMany({
        where,
        select: questionSelect,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.unansweredQuestion.count({ where }),
    ])
    return {
      items: rows.map(row => this.mapper.question(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  async counts(): Promise<UnansweredQuestionCountsDto> {
    const groups = await this.prisma.unansweredQuestion.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    })
    const counts = Object.fromEntries(
      Object.values(QuestionStatus).map(status => [status, 0]),
    ) as UnansweredQuestionCountsDto
    for (const group of groups) counts[group.status] = group._count._all
    return counts
  }

  /** One question (a row action) or a selection of them; each change is audited. */
  async changeStatus({ ids, status }: ChangeQuestionStatusDto, actor: AuditActor): Promise<QuestionStatusResultDto> {
    const unique = [...new Set(ids)]
    return this.prisma.$transaction(
      async tx => {
        // Lock the rows so two staff members changing the same question record one change, not two.
        await tx.$queryRaw`SELECT id FROM UnansweredQuestion WHERE id IN (${Prisma.join(unique)}) FOR UPDATE`
        const rows = await tx.unansweredQuestion.findMany({
          where: { id: { in: unique }, deletedAt: null },
          select: { id: true, status: true },
        })
        if (rows.length !== unique.length) throw new NotFoundException('Pregunta no encontrada.')
        const changed = rows.filter(row => row.status !== status)
        if (changed.length) {
          const resolved = status !== QuestionStatus.OPEN
          await tx.unansweredQuestion.updateMany({
            where: { id: { in: changed.map(row => row.id) } },
            data: { status, resolvedById: resolved ? actor.userId : null, resolvedAt: resolved ? new Date() : null },
          })
          for (const row of changed)
            await this.audit.record(
              actor,
              {
                action: `assistant-question.${AUDIT_VERB[status]}`,
                entityType: 'UnansweredQuestion',
                entityId: row.id,
                changes: { status: { from: row.status, to: status } },
              },
              tx,
            )
        }
        return {
          updated: changed.map(row => row.id),
          unchanged: rows.filter(row => row.status === status).map(row => row.id),
        }
      },
      // Up to 100 questions with their audit rows: more than the 5 s default on a remote database.
      { timeout: 20_000 },
    )
  }
}
