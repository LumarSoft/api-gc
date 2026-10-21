import { Injectable, NotFoundException } from '@nestjs/common'
import { argentineDay, argentineMidnight } from '../common/utils/report-period'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { generateSecureToken, hashToken } from '../common/utils/secure-token'
import { ConversationStatus, MessageRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ChatMessage } from './assistant-model'
import { HISTORY_MESSAGES } from './lib/assistant-limits'

export interface OpenConversation {
  id: number
  /** Only for a conversation created now: the browser keeps it to continue the chat. */
  newToken: string | null
  tokens: number
  customerMessages: number
}

export interface RecordedAnswer {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  productIds: number[]
}

/** Conversations and their messages. A conversation is reached only with its token, whose hash is stored. */
@Injectable()
export class AssistantConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The conversation of `token`, or a new one when there is no token. */
  async open(token: string | undefined, user: AuthenticatedUser | undefined): Promise<OpenConversation> {
    if (!token) {
      const newToken = generateSecureToken()
      const created = await this.prisma.assistantConversation.create({
        data: { sessionId: hashToken(newToken), userId: user?.id ?? null },
        select: { id: true },
      })
      return { id: created.id, newToken, tokens: 0, customerMessages: 0 }
    }
    const conversation = await this.prisma.assistantConversation.findFirst({
      where: { sessionId: hashToken(token), deletedAt: null },
      select: {
        id: true,
        userId: true,
        inputTokens: true,
        outputTokens: true,
        _count: { select: { messages: { where: { role: MessageRole.USER } } } },
      },
    })
    if (!conversation) throw new NotFoundException('La conversación ya no está disponible. Empezá una nueva.')
    // A guest who signs in mid-chat: the conversation becomes theirs.
    if (user && conversation.userId === null)
      await this.prisma.assistantConversation.update({ where: { id: conversation.id }, data: { userId: user.id } })
    return {
      id: conversation.id,
      newToken: null,
      tokens: conversation.inputTokens + conversation.outputTokens,
      customerMessages: conversation._count.messages,
    }
  }

  async recordQuestion(conversationId: number, text: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assistantMessage.create({ data: { conversationId, role: MessageRole.USER, content: text } }),
      this.prisma.assistantConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ])
  }

  /** The answer and what it cost. Called also for interrupted answers, so every token used is counted. */
  async recordAnswer(conversationId: number, answer: RecordedAnswer): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assistantMessage.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: answer.text,
          model: answer.model,
          inputTokens: answer.inputTokens,
          outputTokens: answer.outputTokens,
          recommendedProducts: answer.productIds.length ? answer.productIds : undefined,
        },
      }),
      this.prisma.assistantConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          inputTokens: { increment: answer.inputTokens },
          outputTokens: { increment: answer.outputTokens },
        },
      }),
    ])
  }

  /**
   * The last messages, oldest first, as the model reads them. Answers that showed product cards say which ones, so
   * "the first one" or "that printer" keep their meaning in the next turn.
   */
  async history(conversationId: number): Promise<ChatMessage[]> {
    const messages = await this.prisma.assistantMessage.findMany({
      where: { conversationId, role: { in: [MessageRole.USER, MessageRole.ASSISTANT] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_MESSAGES,
      select: { role: true, content: true, recommendedProducts: true },
    })
    messages.reverse()
    const shownIds = messages.flatMap(message => productIds(message.recommendedProducts))
    const shown = shownIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: shownIds } }, select: { id: true, slug: true } })
      : []
    return messages
      .map(message => {
        if (message.role === MessageRole.USER) return { role: 'user' as const, text: message.content }
        const slugs = productIds(message.recommendedProducts).flatMap(
          id => shown.find(row => row.id === id)?.slug ?? [],
        )
        const cards = slugs.length ? `\n\n[Tarjetas mostradas: ${slugs.join(', ')}]` : ''
        return { role: 'assistant' as const, text: `${message.content}${cards}`.trim() }
      })
      .filter(message => message.text)
  }

  async escalate(conversationId: number, reason: string): Promise<void> {
    await this.prisma.assistantConversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.ESCALATED, escalatedAt: new Date(), escalationReason: reason },
    })
  }

  async recordUnanswered(conversationId: number, question: string): Promise<void> {
    await this.prisma.unansweredQuestion.create({ data: { conversationId, question } })
  }

  /** Tokens used today (Argentine day) by every conversation, for the daily cost limit. */
  async tokensToday(now = new Date()): Promise<number> {
    const totals = await this.prisma.assistantMessage.aggregate({
      where: {
        role: MessageRole.ASSISTANT,
        createdAt: { gte: new Date(argentineMidnight(argentineDay(now))) },
      },
      _sum: { inputTokens: true, outputTokens: true },
    })
    return (totals._sum.inputTokens ?? 0) + (totals._sum.outputTokens ?? 0)
  }
}

/** `recommendedProducts` holds product ids, e.g. [12, 48]. */
function productIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : []
}
