import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import type {
  Response as OpenAiResponse,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses'
import {
  AssistantModelError,
  type AssistantModel,
  type ChatMessage,
  type ToolDefinition,
  type ToolResult,
  type TurnEvent,
  type TurnRequest,
} from '../assistant-model'
import { RepeatedMessages } from './repeated-messages'

/** GPT-6 Luna: OpenAI's small, inexpensive model for high-volume chat (chosen by the client on 2026-10-20). */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna'
/** Lowest to highest. */
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const
type Effort = (typeof REASONING_EFFORTS)[number]
/** Measured on 2026-10-21: same wait as low (6–10 s an answer) and steadier recommendations, for little more cost. */
const DEFAULT_REASONING_EFFORT = 'medium'
/** Until OpenAI answers a call (headers). A turn makes a few calls, and the customer sees the text as it streams in. */
const TIMEOUT_MS = 45_000
/** Longest pause between two events of a call: the SDK timeout stops counting once the stream has started. */
const IDLE_MS = 30_000
/** A whole answer, every call included. The slowest one measured (2026-10-21) took 74 s. */
const TURN_MS = 150_000
/** Tool calls run per step; any more are answered with an error, so a prompted model cannot run dozens at once. */
const MAX_TOOL_CALLS = 4
/** Once the cards are shown only their explanation is left: it needs little reasoning, and medium took up to 23 s. */
const EXPLAIN_EFFORT: Effort = 'low'
/** Characters per token, to estimate what an interrupted call used (Spanish text and JSON; on the generous side). */
const CHARS_PER_TOKEN = 3.5
/** Same key for every conversation: they share the instructions and tools, the prefix OpenAI caches. */
const PROMPT_CACHE_KEY = 'cg-store-assistant'

/** Model and reasoning effort from the environment, with their defaults (also shown on the developers' "Sistema" page). */
export function openAiSettings(read: (key: string) => string | undefined): { model: string; reasoningEffort: Effort } {
  const effort = read('OPENAI_REASONING_EFFORT')?.trim()
  return {
    model: read('OPENAI_MODEL')?.trim() || DEFAULT_OPENAI_MODEL,
    reasoningEffort: REASONING_EFFORTS.find(value => value === effort) ?? DEFAULT_REASONING_EFFORT,
  }
}

/** `AssistantModel` on top of OpenAI's Responses API, with function tools and streamed text. */
@Injectable()
export class OpenAiAssistantModel implements AssistantModel {
  private readonly logger = new Logger(OpenAiAssistantModel.name)
  private readonly client: OpenAI | null
  readonly name: string
  private readonly reasoningEffort: Effort

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY')?.trim() ?? ''
    this.client = apiKey ? new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }) : null
    const settings = openAiSettings(key => config.get<string>(key))
    this.name = settings.model
    this.reasoningEffort = settings.reasoningEffort
  }

  get configured(): boolean {
    return this.client !== null
  }

  async *runTurn<D>(request: TurnRequest<D>): AsyncGenerator<TurnEvent<D>> {
    const client = this.client
    if (!client) throw new AssistantModelError('OpenAI is not configured')
    // Stateless (`store: false`): every call carries the whole turn, including the model's encrypted reasoning.
    const input: ResponseInputItem[] = request.history.map(toInputMessage)
    const deadline = AbortSignal.timeout(TURN_MS)
    // Text written after a tool round continues the same reply: separate it from the text before.
    let textBefore = false
    let effort = this.reasoningEffort
    const repeated = new RepeatedMessages()
    // What the next call reads, in tokens: the first one from its characters, later ones from the previous usage.
    let inputTokens = estimateTokens(request.instructions, JSON.stringify(request.tools), JSON.stringify(input))

    for (let step = 1; step <= request.maxSteps; step++) {
      // The customer left while the tools ran: the next call is never sent, so nothing more is used.
      if (request.signal.aborted) return
      const lastStep = step === request.maxSteps
      const progress: StepProgress = { started: false, outputChars: 0 }
      let response: OpenAiResponse
      try {
        response = yield* this.streamStep(
          client,
          request,
          input,
          { lastStep, textBefore, effort, deadline, repeated },
          progress,
        )
      } catch (error) {
        // OpenAI bills what it read and wrote before the call was cut (the customer left, a timeout): without an
        // estimate the conversation and daily limits would never see it.
        if (progress.started || request.signal.aborted)
          yield { type: 'usage', inputTokens, outputTokens: Math.ceil(progress.outputChars / CHARS_PER_TOKEN) }
        throw error
      }
      const usage = { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }
      yield { type: 'usage', ...usage }
      inputTokens = usage.inputTokens + usage.outputTokens
      if (response.status === 'incomplete')
        this.logger.warn(`OpenAI cut a call short (${response.incomplete_details?.reason ?? 'no reason'})`)
      const wroteText = response.output.some(item => item.type === 'message')
      if (wroteText) textBefore = true
      input.push(...(response.output as ResponseInputItem[]))

      // A call cut by the output cap may have half its arguments: it is not run.
      const calls = response.output.filter(
        (item): item is ResponseFunctionToolCall => item.type === 'function_call' && item.status !== 'incomplete',
      )
      if (!calls.length || lastStep) return
      const results = await Promise.all(
        calls.map((call, index) =>
          index < MAX_TOOL_CALLS
            ? request.runTool(call.name, parseArguments(call.arguments))
            : Promise.resolve<ToolResult<D>>({
                output: { error: `Usá como máximo ${MAX_TOOL_CALLS} herramientas por paso.` },
              }),
        ),
      )
      for (const [index, call] of calls.entries()) {
        const result: ToolResult<D> = results[index]
        if (result.display !== undefined) {
          yield { type: 'display', display: result.display }
          textBefore = false
          if (REASONING_EFFORTS.indexOf(effort) > REASONING_EFFORTS.indexOf(EXPLAIN_EFFORT)) effort = EXPLAIN_EFFORT
        }
        const output = JSON.stringify(result.output)
        inputTokens += estimateTokens(output)
        input.push({ type: 'function_call_output', call_id: call.call_id, output })
      }
      // Quick replies under the question this call just wrote close the answer: nothing is left to say.
      if (wroteText && results.every(result => result.endsTurn === true)) return
    }
  }

  /** One model call: yields its text as it streams and returns the finished response. */
  private async *streamStep<D>(
    client: OpenAI,
    request: TurnRequest<D>,
    input: ResponseInputItem[],
    step: StepOptions,
    progress: StepProgress,
  ): AsyncGenerator<TurnEvent<D>, OpenAiResponse> {
    let finished: OpenAiResponse | null = null
    let separated = !step.textBefore
    // Two messages of one call (a preamble and the answer) are two paragraphs, not one run-on line.
    let shownMessage: string | null = null
    const idle = new AbortController()
    let idleTimer = setTimeout(() => idle.abort(), IDLE_MS)
    const keepAlive = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => idle.abort(), IDLE_MS)
    }
    try {
      const stream = await client.responses.create(
        {
          model: this.name,
          instructions: request.instructions,
          input,
          tools: request.tools.map(toFunctionTool),
          tool_choice: step.lastStep ? 'none' : 'auto',
          parallel_tool_calls: true,
          max_output_tokens: request.maxOutputTokens,
          reasoning: { effort: step.effort },
          store: false,
          include: ['reasoning.encrypted_content'],
          safety_identifier: request.safetyId,
          prompt_cache_key: PROMPT_CACHE_KEY,
          stream: true,
        },
        { signal: AbortSignal.any([request.signal, step.deadline, idle.signal]) },
      )
      progress.started = true
      for await (const event of stream) {
        keepAlive()
        if (event.type === 'response.output_text.delta') {
          progress.outputChars += event.delta.length
          const shown = step.repeated.next(event.item_id, event.delta)
          if (!shown) continue
          if (!separated || (shownMessage !== null && shownMessage !== event.item_id))
            yield { type: 'text', delta: '\n\n' }
          separated = true
          shownMessage = event.item_id
          yield { type: 'text', delta: shown }
        } else if (event.type === 'response.output_item.done' && event.item.type === 'message') {
          step.repeated.finish()
        } else if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
          progress.outputChars += event.item.arguments.length
          // As soon as each call is decided, not when the whole step ends: the wait that follows is what to explain.
          yield { type: 'tool', name: event.item.name, args: parseArguments(event.item.arguments) }
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          // Incomplete = the output token cap was reached: keep what was written.
          finished = event.response
        } else if (event.type === 'response.failed') {
          this.logger.warn(`OpenAI response failed: ${event.response.error?.code ?? 'unknown'}`)
          throw new AssistantModelError('OpenAI could not answer')
        } else if (event.type === 'error') {
          this.logger.warn(`OpenAI stream error: ${event.code ?? 'unknown'}`)
          throw new AssistantModelError('OpenAI could not answer')
        }
      }
    } catch (error) {
      if (error instanceof AssistantModelError || request.signal.aborted) throw error
      if (idle.signal.aborted || step.deadline.aborted) {
        const why = idle.signal.aborted ? `no events for ${IDLE_MS / 1000} s` : `answer over ${TURN_MS / 1000} s`
        this.logger.warn(`OpenAI call given up (${why})`)
        throw new AssistantModelError('OpenAI took too long')
      }
      this.logFailure(error)
      throw new AssistantModelError('OpenAI did not answer')
    } finally {
      clearTimeout(idleTimer)
    }
    if (!finished) throw new AssistantModelError('OpenAI ended the answer without finishing it')
    return finished
  }

  /** Status and OpenAI's own error code only: requests carry the customer's messages. */
  private logFailure(error: unknown): void {
    if (error instanceof OpenAI.APIError) {
      const level = error.status === 401 || error.status === 403 || error.status === 404 ? 'error' : 'warn'
      this.logger[level](
        `OpenAI answered ${error.status ?? 'without status'} (${error.code ?? error.type ?? 'no code'})`,
      )
    } else {
      this.logger.warn(`OpenAI request failed before answering (${error instanceof Error ? error.name : 'unknown'})`)
    }
  }
}

interface StepOptions {
  /** The last call of the turn can only write text. */
  lastStep: boolean
  /** Text was already written in this turn: the next text starts a new paragraph. */
  textBefore: boolean
  effort: Effort
  /** Aborts when the whole answer has taken too long. */
  deadline: AbortSignal
  /** Messages already written in this answer, so a repeated one is not shown again. */
  repeated: RepeatedMessages
}

/** What a call got to do before it ended, to estimate its usage if it is cut. */
interface StepProgress {
  /** OpenAI received the request. */
  started: boolean
  /** Characters the model wrote: text and tool arguments. */
  outputChars: number
}

function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / CHARS_PER_TOKEN)
}

function toInputMessage(message: ChatMessage): ResponseInputItem {
  return { role: message.role, content: message.text, type: 'message' }
}

function toFunctionTool(tool: ToolDefinition) {
  return {
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }
}

/** Strict tools always send JSON objects; anything else reaches the tool as null and is reported back to the model. */
function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
