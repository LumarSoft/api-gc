import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { DateRangeQueryDto } from '../common/dto/date-range-query.dto'
import { addDays, argentineDay, argentineMidnight, periodProblem, reportPeriod } from '../common/utils/report-period'
import { PrismaService } from '../prisma/prisma.service'
import { AssistantConversationsService } from './assistant-conversations.service'
import type { AssistantUsageDto, AssistantUsageTotalsDto } from './dto/admin-assistant-response.dto'
import { monthStart, NO_USAGE, sumUsage, usageDays } from './lib/admin-assistant-rules'
import { assistantLimits, type AssistantLimits } from './lib/assistant-limits'

type DailyUsage = Map<string, Partial<AssistantUsageTotalsDto>>

/** COUNT and SUM come back as bigint or Decimal. */
const count = (value: unknown): number => Number(value ?? 0)

/**
 * What the assistant costs: conversations started and tokens used per Argentine day, the current month (the monthly
 * fee includes a capped number of conversations) and today against the daily token limit.
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
    const [byDay, monthByDay, todayTokens] = await Promise.all([
      this.dailyUsage(period.from, period.until),
      this.dailyUsage(new Date(argentineMidnight(month)), new Date(argentineMidnight(addDays(today, 1)))),
      this.conversations.tokensToday(now),
    ])
    const days = usageDays(period.days, byDay)
    return {
      period: { from: period.days[0], to: period.days.at(-1)! },
      days,
      totals: sumUsage(days),
      month: { from: month, ...sumUsage([...monthByDay.values()].map(day => ({ ...NO_USAGE, ...day }))) },
      today: { tokens: todayTokens, dailyLimit: this.limits.dailyTokens },
    }
  }

  /**
   * Usage grouped by Argentine day (UTC-3 all year, see report-period.ts), computed by the database so a long period
   * does not load every message. Tokens count every answer, also of conversations removed later: they were paid.
   */
  private async dailyUsage(from: Date, until: Date): Promise<DailyUsage> {
    const [conversations, messages] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; conversations: unknown }[]>`
        SELECT DATE_FORMAT(createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') AS day, COUNT(*) AS conversations
        FROM AssistantConversation
        WHERE deletedAt IS NULL AND createdAt >= ${from} AND createdAt < ${until}
        GROUP BY day`,
      this.prisma.$queryRaw<{ day: string; customerMessages: unknown; inputTokens: unknown; outputTokens: unknown }[]>`
        SELECT DATE_FORMAT(createdAt - INTERVAL 3 HOUR, '%Y-%m-%d') AS day,
          SUM(role = 'USER') AS customerMessages,
          SUM(COALESCE(inputTokens, 0)) AS inputTokens,
          SUM(COALESCE(outputTokens, 0)) AS outputTokens
        FROM AssistantMessage
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
      })
    return byDay
  }
}
