import { Prisma } from '../../generated/prisma/client'
import { searchedId } from './admin-assistant-rules'

/** `contains` becomes LIKE: % and _ are escaped so "100%" is searched literally. */
const literal = (q: string): string => q.replace(/[\\%_]/g, '\\$&')

/** Partial match on any message (the customer's or the assistant's) and the customer's name or email, or the id. */
export function conversationSearchWhere(q: string): Prisma.AssistantConversationWhereInput {
  const term = literal(q)
  const id = searchedId(q)
  return {
    OR: [
      ...(id ? [{ id }] : []),
      { messages: { some: { content: { contains: term } } } },
      { user: { email: { contains: term } } },
      { user: { firstName: { contains: term } } },
      { user: { lastName: { contains: term } } },
    ],
  }
}

export const questionSearchWhere = (q: string): Prisma.UnansweredQuestionWhereInput => ({
  question: { contains: literal(q) },
})
