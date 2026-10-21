import { Injectable, NotFoundException } from '@nestjs/common'
import { argentineDay, argentineMidnight } from '../common/utils/report-period'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { generateSecureToken, hashToken } from '../common/utils/secure-token'
import { ConversationStatus, MessageRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { HISTORY_MESSAGES } from './lib/assistant-limits'
import { storedProductIds, type StoredMessage } from './lib/assistant-history'

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

  /** The last messages, oldest first, with the products each answer showed as cards. */
  async history(conversationId: number): Promise<StoredMessage[]> {
    const messages = await this.prisma.assistantMessage.findMany({
      where: { conversationId, role: { in: [MessageRole.USER, MessageRole.ASSISTANT] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_MESSAGES,
      select: { role: true, content: true, recommendedProducts: true },
    })
    return messages.reverse().map(message => ({
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      text: message.content,
      productIds: storedProductIds(message.recommendedProducts),
    }))
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
