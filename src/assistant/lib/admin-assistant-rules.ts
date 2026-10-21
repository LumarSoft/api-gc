import { AnswerOutcome } from '../../generated/prisma/enums'
import type { AssistantUsageDayDto, AssistantUsageTotalsDto } from '../dto/admin-assistant-response.dto'
import { SLOW_ANSWER_MS } from './answer-trace'

/** Length of the first question shown in the conversation list. */
export const EXCERPT_LENGTH = 200

/** The text on one line, cut to `length` characters with an ellipsis (never in the middle of an emoji). */
export function excerpt(text: string, length = EXCERPT_LENGTH): string {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim())
  return characters.length > length
    ? `${characters
        .slice(0, length - 1)
        .join('')
        .trimEnd()}…`
    : characters.join('')
}

/** "#12" or "12": a conversation id typed in the search box. */
export function searchedId(q: string): number | null {
  const match = /^#?(\d{1,9})$/.exec(q)
  return match ? Number(match[1]) : null
}

/** First day of the calendar month of a day ("2026-10-21" → "2026-10-01"). */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`

export const NO_USAGE: AssistantUsageTotalsDto = {
  conversations: 0,
  customerMessages: 0,
  inputTokens: 0,
  outputTokens: 0,
  answers: 0,
  problemAnswers: 0,
  cartAdds: 0,
  cartConversations: 0,
}

/** Why staff should look at an answer (see `problemAnswerWhere`); empty for answers recorded before 2026-10-21. */
export type AnswerProblem = 'FAILED' | 'INTERRUPTED' | 'SLOW' | 'EMPTY_SEARCH'

export function answerProblems(answer: {
  outcome: AnswerOutcome | null
  durationMs: number | null
  emptySearches: number | null
}): AnswerProblem[] {
  const problems: AnswerProblem[] = []
  if (answer.outcome === AnswerOutcome.FAILED) problems.push('FAILED')
  if (answer.outcome === AnswerOutcome.INTERRUPTED) problems.push('INTERRUPTED')
  if ((answer.durationMs ?? 0) >= SLOW_ANSWER_MS) problems.push('SLOW')
  if ((answer.emptySearches ?? 0) > 0) problems.push('EMPTY_SEARCH')
  return problems
}

/** One row per day of the period, oldest first: days missing from `byDay` are zeros. */
export function usageDays(
  days: string[],
  byDay: Map<string, Partial<AssistantUsageTotalsDto>>,
): AssistantUsageDayDto[] {
  return days.map(day => ({ day, ...NO_USAGE, ...byDay.get(day) }))
}

/**
 * Totals of several days. `cartConversations` is counted per day, so a conversation that added on two days counts
 * twice: pass the distinct count of the whole period as `cartConversations` to get it right.
 */
export function sumUsage(rows: AssistantUsageTotalsDto[], cartConversations?: number): AssistantUsageTotalsDto {
  const total = rows.reduce(
    (sum, row) => ({
      conversations: sum.conversations + row.conversations,
      customerMessages: sum.customerMessages + row.customerMessages,
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      answers: sum.answers + row.answers,
      problemAnswers: sum.problemAnswers + row.problemAnswers,
      cartAdds: sum.cartAdds + row.cartAdds,
      cartConversations: sum.cartConversations + row.cartConversations,
    }),
    NO_USAGE,
  )
  return cartConversations === undefined ? total : { ...total, cartConversations }
}
