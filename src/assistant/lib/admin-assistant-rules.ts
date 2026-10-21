import type { AssistantUsageDayDto, AssistantUsageTotalsDto } from '../dto/admin-assistant-response.dto'

/** Length of the first question shown in the conversation list. */
export const EXCERPT_LENGTH = 200

/** The text on one line, cut to `length` characters with an ellipsis. */
export function excerpt(text: string, length = EXCERPT_LENGTH): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > length ? `${line.slice(0, length - 1).trimEnd()}…` : line
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
}

/** One row per day of the period, oldest first: days missing from `byDay` are zeros. */
export function usageDays(
  days: string[],
  byDay: Map<string, Partial<AssistantUsageTotalsDto>>,
): AssistantUsageDayDto[] {
  return days.map(day => ({ day, ...NO_USAGE, ...byDay.get(day) }))
}

export function sumUsage(rows: AssistantUsageTotalsDto[]): AssistantUsageTotalsDto {
  return rows.reduce(
    (total, row) => ({
      conversations: total.conversations + row.conversations,
      customerMessages: total.customerMessages + row.customerMessages,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
    }),
    NO_USAGE,
  )
}
