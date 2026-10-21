import { Prisma } from '../../generated/prisma/client'
import { MessageRole, QuestionStatus } from '../../generated/prisma/enums'

const customerSelect = { select: { id: true, firstName: true, lastName: true, email: true } } as const

export const conversationListSelect = {
  id: true,
  status: true,
  escalationReason: true,
  inputTokens: true,
  outputTokens: true,
  createdAt: true,
  lastMessageAt: true,
  user: customerSelect,
  _count: {
    select: {
      messages: { where: { role: MessageRole.USER } },
      unansweredQuestions: { where: { status: QuestionStatus.OPEN, deletedAt: null } },
    },
  },
} satisfies Prisma.AssistantConversationSelect

export type ConversationListRow = Prisma.AssistantConversationGetPayload<{ select: typeof conversationListSelect }>

export const questionSelect = {
  id: true,
  question: true,
  status: true,
  conversationId: true,
  resolvedAt: true,
  createdAt: true,
  resolvedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.UnansweredQuestionSelect

export type QuestionRow = Prisma.UnansweredQuestionGetPayload<{ select: typeof questionSelect }>

export const conversationDetailSelect = {
  id: true,
  status: true,
  escalatedAt: true,
  escalationReason: true,
  inputTokens: true,
  outputTokens: true,
  createdAt: true,
  lastMessageAt: true,
  user: customerSelect,
  // Not paginated: a conversation is capped at 40 customer messages (MAX_CUSTOMER_MESSAGES), so at most ~80 rows.
  messages: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      recommendedProducts: true,
      createdAt: true,
    },
  },
  unansweredQuestions: { where: { deletedAt: null }, orderBy: { id: 'asc' }, select: questionSelect },
} satisfies Prisma.AssistantConversationSelect

export type ConversationDetailRow = Prisma.AssistantConversationGetPayload<{ select: typeof conversationDetailSelect }>

/** Archived products included: the card shows what the customer saw, flagged when it is no longer in the catalog. */
export const shownProductSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  deletedAt: true,
  images: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
    select: { file: { select: { storageKey: true } } },
  },
} satisfies Prisma.ProductSelect

export type ShownProductRow = Prisma.ProductGetPayload<{ select: typeof shownProductSelect }>
