import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import type {
  AdminCartAddDto,
  AdminConversationDto,
  AdminConversationListItemDto,
  AdminShownProductDto,
  AdminUnansweredQuestionDto,
  AssistantCustomerDto,
} from './dto/admin-assistant-response.dto'
import type {
  ConversationDetailRow,
  ConversationListRow,
  QuestionRow,
  ShownProductRow,
} from './lib/admin-assistant-selects'
import { answerProblems, excerpt } from './lib/admin-assistant-rules'
import { storedTraces } from './lib/answer-trace'
import { storedProductIds } from './lib/assistant-history'

/** Per conversation of a list page: answers to look at and products added to the cart from its cards. */
export type ConversationCounts = { problemAnswers: number; cartAdds: number }

type Person = { id: number; firstName: string; lastName: string }

/** Admin view of the assistant's conversations and the questions it could not answer. */
@Injectable()
export class AdminAssistantMapper {
  constructor(private readonly files: FilesService) {}

  listItem(
    row: ConversationListRow,
    firstQuestion: string | undefined,
    counts: ConversationCounts | undefined,
  ): AdminConversationListItemDto {
    return {
      id: row.id,
      status: row.status,
      firstQuestion: firstQuestion ? excerpt(firstQuestion) : null,
      customer: this.customer(row.user),
      customerMessages: row._count.messages,
      openQuestions: row._count.unansweredQuestions,
      escalationReason: row.escalationReason,
      tokens: row.inputTokens + row.outputTokens,
      problemAnswers: counts?.problemAnswers ?? 0,
      cartAdds: counts?.cartAdds ?? 0,
      createdAt: row.createdAt.toISOString(),
      lastMessageAt: row.lastMessageAt.toISOString(),
    }
  }

  detail(row: ConversationDetailRow, products: ShownProductRow[]): AdminConversationDto {
    const cards = new Map(products.map(product => [product.id, this.shownProduct(product)]))
    return {
      id: row.id,
      status: row.status,
      customer: this.customer(row.user),
      escalatedAt: row.escalatedAt?.toISOString() ?? null,
      escalationReason: row.escalationReason,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      createdAt: row.createdAt.toISOString(),
      lastMessageAt: row.lastMessageAt.toISOString(),
      messages: row.messages.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        model: message.model,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
        products: storedProductIds(message.recommendedProducts).flatMap(id => cards.get(id) ?? []),
        page: message.productId === null ? null : (cards.get(message.productId) ?? null),
        outcome: message.outcome,
        durationMs: message.durationMs,
        tools: storedTraces(message.toolCalls),
        problems: answerProblems(message),
        createdAt: message.createdAt.toISOString(),
      })),
      questions: row.unansweredQuestions.map(question => this.question(question)),
      cartAdds: row.cartAdds.flatMap((add): AdminCartAddDto[] => {
        const product = cards.get(add.productId)
        return product ? [{ product, variantId: add.variantId, createdAt: add.createdAt.toISOString() }] : []
      }),
    }
  }

  question(row: QuestionRow): AdminUnansweredQuestionDto {
    return {
      id: row.id,
      question: row.question,
      status: row.status,
      conversationId: row.conversationId,
      resolvedBy: row.resolvedBy ? { id: row.resolvedBy.id, name: fullName(row.resolvedBy) } : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }
  }

  private shownProduct(row: ShownProductRow): AdminShownProductDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      archived: row.deletedAt !== null,
      imageUrl: row.images[0] ? this.files.publicUrl(row.images[0].file.storageKey) : null,
    }
  }

  private customer(user: (Person & { email: string }) | null): AssistantCustomerDto | null {
    return user ? { id: user.id, name: fullName(user), email: user.email } : null
  }
}

const fullName = (person: Person): string => `${person.firstName} ${person.lastName}`.trim()
