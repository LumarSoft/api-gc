import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { periodProblem, reportPeriod } from '../common/utils/report-period'
import { Prisma } from '../generated/prisma/client'
import { MessageRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { AdminAssistantMapper, type ConversationCounts } from './admin-assistant.mapper'
import type { ListAssistantConversationsDto } from './dto/admin-assistant-input.dto'
import type { AdminConversationDto, AdminConversationsPageDto } from './dto/admin-assistant-response.dto'
import { conversationSearchWhere } from './lib/admin-assistant-search'
import {
  conversationDetailSelect,
  conversationListSelect,
  problemAnswerWhere,
  shownProductSelect,
} from './lib/admin-assistant-selects'
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
    const ids = rows.map(row => row.id)
    const [firstQuestions, counts] = await Promise.all([this.firstQuestions(ids), this.counts(ids)])
    return {
      items: rows.map(row => this.mapper.listItem(row, firstQuestions.get(row.id), counts.get(row.id))),
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
    const ids = [
      ...new Set([
        ...row.messages.flatMap(message => storedProductIds(message.recommendedProducts)),
        ...row.cartAdds.map(add => add.productId),
      ]),
    ]
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
      AND: [
        ...(query.status ? [{ status: query.status }] : []),
        ...(period ? [{ createdAt: { gte: period.from, lt: period.until } }] : []),
        ...(query.problems ? [{ messages: { some: problemAnswerWhere } }] : []),
        ...(query.q ? [conversationSearchWhere(query.q)] : []),
      ],
    }
  }

  /** Answers to look at and products added to the cart, per conversation of a page. */
  private async counts(conversationIds: number[]): Promise<Map<number, ConversationCounts>> {
    if (!conversationIds.length) return new Map()
    const [problems, cartAdds] = await Promise.all([
      this.prisma.assistantMessage.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: conversationIds }, ...problemAnswerWhere },
        _count: { _all: true },
      }),
      this.prisma.assistantCartAdd.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: conversationIds } },
        _count: { _all: true },
      }),
    ])
    const counts = new Map<number, ConversationCounts>()
    const entry = (id: number): ConversationCounts => counts.get(id) ?? { problemAnswers: 0, cartAdds: 0 }
    for (const group of problems)
      counts.set(group.conversationId, { ...entry(group.conversationId), problemAnswers: group._count._all })
    for (const group of cartAdds)
      counts.set(group.conversationId, { ...entry(group.conversationId), cartAdds: group._count._all })
    return counts
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
