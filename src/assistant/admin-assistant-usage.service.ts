import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { DateRangeQueryDto } from '../common/dto/date-range-query.dto'
import { addDays, argentineDay, argentineMidnight, periodProblem, reportPeriod } from '../common/utils/report-period'
import { PrismaService } from '../prisma/prisma.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import type {
  AssistantEmptySearchDto,
  AssistantUsageDto,
  AssistantUsageTotalsDto,
} from './dto/admin-assistant-response.dto'
import { monthStart, NO_USAGE, sumUsage, usageDays } from './lib/admin-assistant-rules'
import { SLOW_ANSWER_MS } from './lib/answer-trace'
import { assistantLimits, type AssistantLimits } from './lib/assistant-limits'

type DailyUsage = Map<string, Partial<AssistantUsageTotalsDto>>

/** COUNT and SUM come back as bigint or Decimal. */
const count = (value: unknown): number => Number(value ?? 0)

/**
 * What the assistant costs and how it does: conversations started and tokens used per Argentine day, the current month
 * (the monthly fee includes a capped number of conversations), today against the daily token limit, answers to look
 * at, products added to the cart from its cards and the searches that found nothing.
 */
@Injectable()
export class AdminAssistantUsageService {
  private readonly limits: AssistantLimits

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: AssistantConversationsService,
    config: ConfigService,
  ) {
    this.limits = assistantLimits(key => config.get<string>(key))
  }

  /** The requested days or, without them, the last 30 up to today. */
  async report(query: DateRangeQueryDto, now = new Date()): Promise<AssistantUsageDto> {
    const problem = periodProblem(now, query.from, query.to)
    if (problem) throw new BadRequestException(problem)
    const period = reportPeriod(now, query.from, query.to)
    const today = argentineDay(now)
    const month = monthStart(today)
    const monthFrom = new Date(argentineMidnight(month))
    const monthUntil = new Date(argentineMidnight(addDays(today, 1)))
    const [byDay, monthByDay, todayTokens, cartConversations, monthCartConversations, emptySearches] =
      await Promise.all([
        this.dailyUsage(period.from, period.until),
        this.dailyUsage(monthFrom, monthUntil),
        this.conversations.tokensToday(now),
        this.cartConversations(period.from, period.until),
        this.cartConversations(monthFrom, monthUntil),
        this.emptySearches(period.from, period.until),
      ])
    const days = usageDays(period.days, byDay)
    const monthDays = [...monthByDay.values()].map(day => ({ ...NO_USAGE, ...day }))
    return {
      period: { from: period.days[0], to: period.days.at(-1)! },
      days,
      totals: sumUsage(days, cartConversations),
      month: { from: month, ...sumUsage(monthDays, monthCartConversations) },
      today: { tokens: todayTokens, dailyLimit: this.limits.dailyTokens },
      emptySearches,
    }
  }

  /**
   * Usage grouped by Argentine day (UTC-3 all year, see report-period.ts), computed by the database so a long period
   * does not load every message. Tokens count every answer, also of conversations removed later: they were paid.
   */
  private async dailyUsage(from: Date, until: Date): Promise<DailyUsage> {
    const [conversations, messages, cartAdds] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; conversations: unknown }[]>`
        SELECT DATE_FORMAT(createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') AS day, COUNT(*) AS conversations
        FROM AssistantConversation
        WHERE deletedAt IS NULL AND createdAt >= ${from} AND createdAt < ${until}
        GROUP BY day`,
      // Problem answers: the same rule as `problemAnswerWhere` (lib/admin-assistant-selects.ts).
      this.prisma.$queryRaw<
        {
          day: string
          customerMessages: unknown
          inputTokens: unknown
          outputTokens: unknown
          answers: unknown
          problemAnswers: unknown
        }[]
      >`
        SELECT DATE_FORMAT(createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') AS day,
          SUM(role = 'USER') AS customerMessages,
          SUM(COALESCE(inputTokens, 0)) AS inputTokens,
          SUM(COALESCE(outputTokens, 0)) AS outputTokens,
          SUM(role = 'ASSISTANT' AND outcome IS NOT NULL) AS answers,
          SUM(role = 'ASSISTANT' AND (outcome IN ('FAILED', 'INTERRUPTED') OR durationMs >= ${SLOW_ANSWER_MS}
            OR emptySearches > 0)) AS problemAnswers
        FROM AssistantMessage
        WHERE createdAt >= ${from} AND createdAt < ${until}
        GROUP BY day`,
      this.prisma.$queryRaw<{ day: string; cartAdds: unknown; cartConversations: unknown }[]>`
        SELECT DATE_FORMAT(createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') AS day,
          COUNT(*) AS cartAdds, COUNT(DISTINCT conversationId) AS cartConversations
        FROM AssistantCartAdd
        WHERE createdAt >= ${from} AND createdAt < ${until}
        GROUP BY day`,
    ])
    const byDay: DailyUsage = new Map()
    for (const row of conversations) byDay.set(row.day, { conversations: count(row.conversations) })
    for (const row of messages)
      byDay.set(row.day, {
        ...byDay.get(row.day),
        customerMessages: count(row.customerMessages),
        inputTokens: count(row.inputTokens),
        outputTokens: count(row.outputTokens),
        answers: count(row.answers),
        problemAnswers: count(row.problemAnswers),
      })
    for (const row of cartAdds)
      byDay.set(row.day, {
        ...byDay.get(row.day),
        cartAdds: count(row.cartAdds),
        cartConversations: count(row.cartConversations),
      })
    return byDay
  }

  /** Conversations with a product added to the cart from their cards, each once however many days it added. */
  private async cartConversations(from: Date, until: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ conversations: unknown }[]>`
      SELECT COUNT(DISTINCT conversationId) AS conversations
      FROM AssistantCartAdd
      WHERE createdAt >= ${from} AND createdAt < ${until}`
    return count(rows[0]?.conversations)
  }

  /**
   * Searches of the assistant that found nothing, grouped by their text without case, spaces or dashes ("XQ-7781" and
   * "xq 7781" are one), most repeated first.
   */
  private async emptySearches(from: Date, until: Date): Promise<AssistantEmptySearchDto[]> {
    const rows = await this.prisma.$queryRaw<
      { term: string; searches: unknown; conversations: unknown; lastConversationId: unknown }[]
    >`
      SELECT MIN(LOWER(search.term)) AS term, COUNT(*) AS searches,
        COUNT(DISTINCT message.conversationId) AS conversations, MAX(message.conversationId) AS lastConversationId
      FROM AssistantMessage AS message,
        JSON_TABLE(message.toolCalls, '$[*]' COLUMNS (
          tool VARCHAR(40) PATH '$.tool',
          term VARCHAR(100) PATH '$.text',
          results INT PATH '$.results'
        )) AS search
      WHERE message.role = 'ASSISTANT' AND message.toolCalls IS NOT NULL
        AND message.createdAt >= ${from} AND message.createdAt < ${until}
        AND search.tool = 'search_products' AND search.results = 0 AND search.term IS NOT NULL
      GROUP BY LOWER(REGEXP_REPLACE(search.term, '[^[:alnum:]]', ''))
      ORDER BY searches DESC, lastConversationId DESC
      LIMIT 20`
    return rows.map(row => ({
      text: row.term,
      searches: count(row.searches),
      conversations: count(row.conversations),
      lastConversationId: count(row.lastConversationId),
    }))
  }
}
