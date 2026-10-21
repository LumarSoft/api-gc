import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { periodProblem, reportPeriod } from '../common/utils/report-period'
import { Prisma } from '../generated/prisma/client'
import { MessageRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminAssistantMapper } from './admin-assistant.mapper'
import type { ListAssistantConversationsDto } from './dto/admin-assistant-input.dto'
import type { AdminConversationDto, AdminConversationsPageDto } from './dto/admin-assistant-response.dto'
import { conversationSearchWhere } from './lib/admin-assistant-search'
import { conversationDetailSelect, conversationListSelect, shownProductSelect } from './lib/admin-assistant-selects'
import { storedProductIds } from './lib/assistant-history'

/** What customers asked the assistant: staff read the conversations and the products shown, without answering. */
@Injectable()
export class AdminAssistantConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: AdminAssistantMapper,
  ) {}

  /** Most recent activity first. */
  async list(query: ListAssistantConversationsDto, now = new Date()): Promise<AdminConversationsPageDto> {
    const where = this.listWhere(query, now)
    const [rows, total] = await Promise.all([
      this.prisma.assistantConversation.findMany({
        where,
        select: conversationListSelect,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.assistantConversation.count({ where }),
    ])
    const firstQuestions = await this.firstQuestions(rows.map(row => row.id))
    return {
      items: rows.map(row => this.mapper.listItem(row, firstQuestions.get(row.id))),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    }
  }

  async read(id: number): Promise<AdminConversationDto> {
    const row = await this.prisma.assistantConversation.findFirst({
      where: { id, deletedAt: null },
      select: conversationDetailSelect,
    })
    if (!row) throw new NotFoundException('Conversación no encontrada.')
    const ids = [...new Set(row.messages.flatMap(message => storedProductIds(message.recommendedProducts)))]
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids } }, select: shownProductSelect })
      : []
    return this.mapper.detail(row, products)
  }

  private listWhere(query: ListAssistantConversationsDto, now: Date): Prisma.AssistantConversationWhereInput {
    const problem = periodProblem(now, query.from, query.to)
    if (problem) throw new BadRequestException(problem)
    const period = query.from && query.to ? reportPeriod(now, query.from, query.to) : null
    return {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(period ? { createdAt: { gte: period.from, lt: period.until } } : {}),
      ...(query.q ? conversationSearchWhere(query.q) : {}),
    }
  }

  /** The customer's first message of each conversation (the lowest id: messages are inserted in order). */
  private async firstQuestions(conversationIds: number[]): Promise<Map<number, string>> {
    if (!conversationIds.length) return new Map()
    const firsts = await this.prisma.assistantMessage.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversationIds }, role: MessageRole.USER },
      _min: { id: true },
    })
    const messages = await this.prisma.assistantMessage.findMany({
      where: { id: { in: firsts.flatMap(group => group._min.id ?? []) } },
      select: { conversationId: true, content: true },
    })
    return new Map(messages.map(message => [message.conversationId, message.content]))
  }
}
