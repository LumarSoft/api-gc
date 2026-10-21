import {
  AnswerOutcome,
  ConversationStatus,
  MessageRole,
  ProductStatus,
  QuestionStatus,
} from '../../generated/prisma/enums'
import type { ToolTrace } from '../lib/answer-trace'
import type { AnswerProblem } from '../lib/admin-assistant-rules'

/** The signed-in customer who wrote; null in the DTOs below for a guest. */
export class AssistantCustomerDto {
  id: number
  name: string
  email: string
}

export class AdminConversationListItemDto {
  id: number
  status: ConversationStatus
  /** The customer's first message, cut to 200 characters; null when it has none. */
  firstQuestion: string | null
  customer: AssistantCustomerDto | null
  customerMessages: number
  /** Questions of this conversation the assistant could not answer that are still open. */
  openQuestions: number
  escalationReason: string | null
  /** Input + output tokens of the whole conversation. */
  tokens: number
  /** Answers to look at (failed, cut, slow, searches that found nothing). */
  problemAnswers: number
  /** Products added to the cart from this conversation's cards. */
  cartAdds: number
  createdAt: string
  lastMessageAt: string
}

export class AdminConversationsPageDto {
  items: AdminConversationListItemDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** A product the assistant showed as a card, as it is now in the catalog (it may have changed or been archived). */
export class AdminShownProductDto {
  id: number
  name: string
  slug: string
  status: ProductStatus
  archived: boolean
  imageUrl: string | null
}

export class AdminAssistantMessageDto {
  id: number
  role: MessageRole
  content: string
  /** Model that wrote an answer; null for the customer's messages. */
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  /** Cards shown with this answer, in order. */
  products: AdminShownProductDto[]
  /** Customer messages only: the product page it was written from (since 2026-10-21); null elsewhere. */
  page: AdminShownProductDto | null
  /** Answers only; null for the customer's messages and answers recorded before 2026-10-21. */
  outcome: AnswerOutcome | null
  durationMs: number | null
  /** The tools the model used for this answer, in order: what it searched and found, the sheets it read… */
  tools: ToolTrace[]
  problems: AnswerProblem[]
  createdAt: string
}

/** A product the customer added to the cart from one of the conversation's cards. */
export class AdminCartAddDto {
  product: AdminShownProductDto
  variantId: number | null
  createdAt: string
}

export class AdminUnansweredQuestionDto {
  id: number
  question: string
  status: QuestionStatus
  conversationId: number | null
  /** Who marked it answered or dismissed. */
  resolvedBy: { id: number; name: string } | null
  resolvedAt: string | null
  createdAt: string
}

export class AdminConversationDto {
  id: number
  status: ConversationStatus
  customer: AssistantCustomerDto | null
  escalatedAt: string | null
  escalationReason: string | null
  inputTokens: number
  outputTokens: number
  createdAt: string
  lastMessageAt: string
  /** Every message, oldest first (a conversation takes up to 40 customer messages). */
  messages: AdminAssistantMessageDto[]
  /** Questions it could not answer in this conversation. */
  questions: AdminUnansweredQuestionDto[]
  /** Products added to the cart from its cards, oldest first. */
  cartAdds: AdminCartAddDto[]
}

export class UnansweredQuestionsPageDto {
  items: AdminUnansweredQuestionDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** GET /admin/assistant/questions/counts: questions in each status, for the list views and the nav badge. */
export type UnansweredQuestionCountsDto = Record<QuestionStatus, number>

export class QuestionStatusResultDto {
  /** Questions whose status changed. */
  updated: number[]
  /** Already in the requested status. */
  unchanged: number[]
}

export class AssistantUsageTotalsDto {
  /** Conversations started. */
  conversations: number
  customerMessages: number
  inputTokens: number
  outputTokens: number
  /** Answers recorded with their outcome (from 2026-10-21) and, of them, the ones to look at. */
  answers: number
  problemAnswers: number
  /** Products added to the cart from the assistant's cards, and the conversations they came from. */
  cartAdds: number
  cartConversations: number
}

/** A search of the assistant that found nothing, by its text: a product to load or a word the search misses. */
export class AssistantEmptySearchDto {
  text: string
  searches: number
  conversations: number
  /** The latest conversation with it, to read. */
  lastConversationId: number
}

export class AssistantUsageDayDto extends AssistantUsageTotalsDto {
  /** Argentine calendar day, "2026-10-21". */
  day: string
}

export class AssistantUsageDto {
  period: { from: string; to: string }
  /** One row per day of the period, oldest first; days without activity are zeros. */
  days: AssistantUsageDayDto[]
  totals: AssistantUsageTotalsDto
  /** The current calendar month up to now, for the monthly allowance. */
  month: AssistantUsageTotalsDto & { from: string }
  /** Tokens used today against `ASSISTANT_DAILY_TOKEN_LIMIT`; past it the assistant pauses until midnight. */
  today: { tokens: number; dailyLimit: number }
  /** The searches of the period that found nothing, most repeated first (top 20). */
  emptySearches: AssistantEmptySearchDto[]
}
