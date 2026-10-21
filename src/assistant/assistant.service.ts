import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { argentineDay } from '../common/utils/report-period'
import { hashToken } from '../common/utils/secure-token'
import { AssistantCatalogService } from './assistant-catalog.service'
import { AssistantContextService } from './assistant-context.service'
import { AssistantConversationsService, type OpenConversation } from './assistant-conversations.service'
import { ASSISTANT_MODEL, AssistantModelError, type AssistantModel } from './assistant-model'
import { AssistantToolsService } from './assistant-tools.service'
import type { AssistantStreamEvent } from './dto/assistant-stream.dto'
import type { SendAssistantMessageDto } from './dto/send-assistant-message.dto'
import { chatHistory } from './lib/assistant-history'
import { toolStatus } from './lib/tool-status'
import { assistantLimits, conversationLimitProblem, MAX_TURN_STEPS, type AssistantLimits } from './lib/assistant-limits'
import { VISITOR_LIMIT_MESSAGE, VisitorBudget, visitorKeys } from './lib/visitor-budget'

const UNAVAILABLE = 'El asesor no está disponible en este momento. Probá de nuevo más tarde.'
const ANSWER_FAILED = 'No pude terminar la respuesta. Probá de nuevo en un momento.'
/** The daily total is read from the database at most this often; answers in between add their own tokens. */
const DAILY_USAGE_CACHE_MS = 60_000

/** One customer message and the assistant's streamed answer, within the cost limits. */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name)
  private readonly limits: AssistantLimits
  /** Conversations answering right now: one answer at a time per conversation. Single API instance. */
  private readonly answering = new Set<number>()
  private dailyUsage: { tokens: number; day: string; readAt: number } | null = null
  private readonly visitors: VisitorBudget

  constructor(
    @Inject(ASSISTANT_MODEL) private readonly model: AssistantModel,
    private readonly conversations: AssistantConversationsService,
    private readonly catalog: AssistantCatalogService,
    private readonly context: AssistantContextService,
    private readonly tools: AssistantToolsService,
    config: ConfigService,
  ) {
    this.limits = assistantLimits(key => config.get<string>(key))
    this.visitors = new VisitorBudget(this.limits.dailyTokens)
  }

  /**
   * Every check that can refuse the message, before the answer starts streaming (so they are plain HTTP errors).
   * On success the conversation is reserved until `answer` finishes: always call it next.
   */
  async open(
    input: SendAssistantMessageDto,
    user: AuthenticatedUser | undefined,
    ip: string | undefined,
  ): Promise<OpenTurn> {
    if (!this.model.configured) throw new ServiceUnavailableException(UNAVAILABLE)
    if ((await this.tokensToday()) >= this.limits.dailyTokens) {
      this.logger.warn(`Daily token limit reached (${this.limits.dailyTokens}): the assistant is paused until tomorrow`)
      throw new ServiceUnavailableException(UNAVAILABLE)
    }
    const visitor = visitorKeys(ip, user?.id)
    const now = Date.now()
    const day = argentineDay(new Date(now))
    if (!this.visitors.allows(visitor, !input.conversation, day, now))
      throw new HttpException(VISITOR_LIMIT_MESSAGE, HttpStatus.TOO_MANY_REQUESTS)
    const conversation = await this.conversations.open(input.conversation, user)
    const problem = conversationLimitProblem(
      { tokens: conversation.tokens, customerMessages: conversation.customerMessages },
      this.limits,
    )
    if (problem) throw new UnprocessableEntityException(problem)
    if (this.answering.has(conversation.id)) throw new ConflictException('Esperá a que termine la respuesta anterior.')
    // Reserved in the same step as the check, so two simultaneous messages cannot both pass. `answer` releases it.
    this.answering.add(conversation.id)
    if (conversation.newToken) this.visitors.started(visitor, day, now)
    return { ...conversation, visitor }
  }

  async *answer(
    conversation: OpenTurn,
    input: SendAssistantMessageDto,
    user: AuthenticatedUser | undefined,
    signal: AbortSignal,
  ): AsyncGenerator<AssistantStreamEvent> {
    const answer: RecordedTurn = { text: '', productIds: [], inputTokens: 0, outputTokens: 0 }
    try {
      if (conversation.newToken) yield { type: 'conversation', token: conversation.newToken }
      // From here on the stream has started: every failure ends it with an error line, never a hung response.
      try {
        await this.conversations.recordQuestion(conversation.id, input.message)
        const [stored, instructions] = await Promise.all([
          this.conversations.history(conversation.id),
          this.context.instructions(user, input.productSlug),
        ])
        const shown = await this.catalog.shownLines(
          stored.flatMap(message => message.productIds),
          user,
        )
        const turn = this.model.runTurn({
          instructions,
          history: chatHistory(stored, shown),
          tools: this.tools.definitions(),
          runTool: (name, args) => this.tools.run(name, args, { conversationId: conversation.id, user }),
          maxSteps: MAX_TURN_STEPS,
          maxOutputTokens: this.limits.maxOutputTokens,
          safetyId: hashToken(`assistant-conversation-${conversation.id}`).slice(0, 32),
          signal,
        })
        for await (const event of turn) {
          if (event.type === 'usage') {
            answer.inputTokens += event.inputTokens
            answer.outputTokens += event.outputTokens
            continue
          }
          if (event.type === 'tool') {
            const text = toolStatus(event.name, event.args)
            if (text) yield { type: 'status', text }
            continue
          }
          if (event.type === 'text') answer.text += event.delta
          else if (event.display.type === 'products')
            answer.productIds.push(...event.display.items.map(item => item.id))
          yield event.type === 'text' ? event : event.display
        }
        if (!answer.text.trim() && !answer.productIds.length) yield { type: 'error', message: ANSWER_FAILED }
      } catch (error) {
        if (!signal.aborted) {
          if (!(error instanceof AssistantModelError))
            this.logger.error(`Answer failed: ${error instanceof Error ? error.message : String(error)}`)
          yield { type: 'error', message: ANSWER_FAILED }
        }
      }
      yield { type: 'done' }
    } finally {
      // Also when the customer leaves mid-answer: the tokens were used all the same.
      const tokens = answer.inputTokens + answer.outputTokens
      this.visitors.spent(conversation.visitor, tokens, argentineDay(new Date()), Date.now())
      await this.record(conversation.id, answer)
      this.answering.delete(conversation.id)
    }
  }

  private async record(conversationId: number, answer: RecordedTurn): Promise<void> {
    if (this.dailyUsage) this.dailyUsage.tokens += answer.inputTokens + answer.outputTokens
    if (!answer.text.trim() && !answer.productIds.length && !answer.inputTokens) return
    try {
      await this.conversations.recordAnswer(conversationId, { ...answer, model: this.model.name })
    } catch (error) {
      this.logger.error(`Could not record an answer: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async tokensToday(): Promise<number> {
    const now = Date.now()
    const day = argentineDay(new Date(now))
    if (!this.dailyUsage || this.dailyUsage.day !== day || now - this.dailyUsage.readAt > DAILY_USAGE_CACHE_MS)
      this.dailyUsage = { tokens: await this.conversations.tokensToday(), day, readAt: now }
    return this.dailyUsage.tokens
  }
}

type RecordedTurn = { text: string; productIds: number[]; inputTokens: number; outputTokens: number }

/** An opened conversation and the visitor sending the message, whose usage the answer adds to. */
export type OpenTurn = OpenConversation & { visitor: string[] }
