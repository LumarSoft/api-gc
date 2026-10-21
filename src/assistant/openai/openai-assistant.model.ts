import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import type {
  Response as OpenAiResponse,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses'
import type { ReasoningEffort } from 'openai/resources/shared'
import {
  AssistantModelError,
  type AssistantModel,
  type ChatMessage,
  type ToolDefinition,
  type TurnEvent,
  type TurnRequest,
} from '../assistant-model'

/** GPT-6 Luna: OpenAI's small, inexpensive model for high-volume chat (chosen by the client on 2026-10-20). */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna'
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const
/** Measured on 2026-10-21: same wait as low (6–10 s an answer) and steadier recommendations, for little more cost. */
const DEFAULT_REASONING_EFFORT = 'medium'
/** Per model call. A turn makes a few calls, and the customer sees the text as it streams in. */
const TIMEOUT_MS = 45_000

/** `AssistantModel` on top of OpenAI's Responses API, with function tools and streamed text. */
@Injectable()
export class OpenAiAssistantModel implements AssistantModel {
  private readonly logger = new Logger(OpenAiAssistantModel.name)
  private readonly client: OpenAI | null
  readonly name: string
  private readonly reasoningEffort: ReasoningEffort

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY')?.trim() ?? ''
    this.client = apiKey ? new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 }) : null
    this.name = config.get<string>('OPENAI_MODEL')?.trim() || DEFAULT_OPENAI_MODEL
    const effort = config.get<string>('OPENAI_REASONING_EFFORT')?.trim()
    this.reasoningEffort = REASONING_EFFORTS.find(value => value === effort) ?? DEFAULT_REASONING_EFFORT
  }

  get configured(): boolean {
    return this.client !== null
  }

  async *runTurn<D>(request: TurnRequest<D>): AsyncGenerator<TurnEvent<D>> {
    const client = this.client
    if (!client) throw new AssistantModelError('OpenAI is not configured')
    // Stateless (`store: false`): every call carries the whole turn, including the model's encrypted reasoning.
    const input: ResponseInputItem[] = request.history.map(toInputMessage)
    // Text written after a tool round continues the same reply: separate it from the text before.
    let textBefore = false

    for (let step = 1; step <= request.maxSteps; step++) {
      const lastStep = step === request.maxSteps
      const response = yield* this.streamStep(client, request, input, lastStep, textBefore)
      yield {
        type: 'usage',
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      }
      if (response.output.some(item => item.type === 'message')) textBefore = true
      input.push(...(response.output as ResponseInputItem[]))

      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call')
      if (!calls.length || lastStep) return
      for (const call of calls) {
        const result = await request.runTool(call.name, parseArguments(call.arguments))
        if (result.display !== undefined) {
          yield { type: 'display', display: result.display }
          textBefore = false
        }
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result.output) })
      }
    }
  }

  /** One model call: yields its text as it streams and returns the finished response. */
  private async *streamStep<D>(
    client: OpenAI,
    request: TurnRequest<D>,
    input: ResponseInputItem[],
    lastStep: boolean,
    textBefore: boolean,
  ): AsyncGenerator<TurnEvent<D>, OpenAiResponse> {
    let finished: OpenAiResponse | null = null
    let separated = !textBefore
    try {
      const stream = await client.responses.create(
        {
          model: this.name,
          instructions: request.instructions,
          input,
          tools: request.tools.map(toFunctionTool),
          tool_choice: lastStep ? 'none' : 'auto',
          parallel_tool_calls: true,
          max_output_tokens: request.maxOutputTokens,
          reasoning: { effort: this.reasoningEffort },
          store: false,
          include: ['reasoning.encrypted_content'],
          safety_identifier: request.safetyId,
          stream: true,
        },
        { signal: request.signal },
      )
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          if (!separated) {
            separated = true
            yield { type: 'text', delta: '\n\n' }
          }
          yield { type: 'text', delta: event.delta }
        } else if (event.type === 'response.output_item.done' && event.item.type === 'function_call') {
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
      this.logFailure(error)
      throw new AssistantModelError('OpenAI did not answer')
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
