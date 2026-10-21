import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { argentineDay, argentineMidnight } from '../common/utils/report-period'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { generateSecureToken, hashToken } from '../common/utils/secure-token'
import { AnswerOutcome, ConversationStatus, MessageRole } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { ToolTrace } from './lib/answer-trace'
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
  outcome: AnswerOutcome
  durationMs: number
  toolCalls: ToolTrace[]
  emptySearches: number
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

  /** `productId`: the product page the customer wrote it from. */
  async recordQuestion(conversationId: number, text: string, productId: number | null): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assistantMessage.create({
        data: { conversationId, role: MessageRole.USER, content: text, productId },
      }),
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
          outcome: answer.outcome,
          durationMs: answer.durationMs,
          toolCalls: answer.toolCalls.length ? answer.toolCalls : undefined,
          emptySearches: answer.emptySearches,
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
   * A product added to the cart from a card of the conversation of `token`. Only products the conversation showed
   * count, so the numbers say what the assistant sold and nothing else.
   */
  async recordCartAdd(token: string, productId: number, variantId: number | undefined): Promise<void> {
    const conversation = await this.prisma.assistantConversation.findFirst({
      where: { sessionId: hashToken(token), deletedAt: null },
      select: {
        id: true,
        messages: { where: { role: MessageRole.ASSISTANT }, select: { recommendedProducts: true } },
      },
    })
    if (!conversation) throw new NotFoundException('La conversación ya no está disponible.')
    const shown = conversation.messages.some(message =>
      storedProductIds(message.recommendedProducts).includes(productId),
    )
    if (!shown) throw new UnprocessableEntityException('Ese producto no se mostró en esta conversación.')
    const variant = variantId
      ? await this.prisma.productVariant.findFirst({ where: { id: variantId, productId }, select: { id: true } })
      : null
    if (variantId && !variant) throw new UnprocessableEntityException('Esa variante no es de ese producto.')
    await this.prisma.assistantCartAdd.create({
      data: { conversationId: conversation.id, productId, variantId: variant?.id ?? null },
    })
  }

  /** The last messages, oldest first, with the products each answer showed as cards. */
  async history(conversationId: number): Promise<StoredMessage[]> {
    const messages = await this.prisma.assistantMessage.findMany({
      where: { conversationId, role: { in: [MessageRole.USER, MessageRole.ASSISTANT] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_MESSAGES,
      select: { role: true, content: true, recommendedProducts: true, productId: true },
    })
    return messages.reverse().map(message => ({
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      text: message.content,
      productIds: storedProductIds(message.recommendedProducts),
      pageId: message.productId,
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
