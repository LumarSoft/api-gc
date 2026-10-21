/** Injection token of the language model behind the store assistant. The assistant depends on `AssistantModel`. */
export const ASSISTANT_MODEL = Symbol('ASSISTANT_MODEL')

/** One message of the conversation as the model reads it. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** JSON schema of the arguments. Strict: every property is required (nullable when optional), no extra ones. */
  parameters: Record<string, unknown>
}

/** What a tool returns: `output` goes back to the model; `display`, when set, is shown to the customer. */
export interface ToolResult<D> {
  output: unknown
  display?: D
}

export interface TurnRequest<D> {
  instructions: string
  /** Oldest first; the customer's new message is the last one. */
  history: ChatMessage[]
  tools: ToolDefinition[]
  runTool: (name: string, args: unknown) => Promise<ToolResult<D>>
  /** Model calls in one turn (each tool round is one more); the last one can only answer with text. */
  maxSteps: number
  /** Per model call, reasoning included. */
  maxOutputTokens: number
  /** Opaque, stable id of the conversation for the provider's abuse monitoring. Never personal data. */
  safetyId: string
  signal: AbortSignal
}

export type TurnEvent<D> =
  | { type: 'text'; delta: string }
  /** The model decided to call a tool, before it runs: the customer can be told what is happening. */
  | { type: 'tool'; name: string; args: unknown }
  | { type: 'display'; display: D }
  /** After every model call, so an interrupted turn still counts what it used. */
  | { type: 'usage'; inputTokens: number; outputTokens: number }

export interface AssistantModel {
  /** False until the provider's credentials are configured; the assistant is then unavailable. */
  readonly configured: boolean
  /** Model id, stored with every answer. */
  readonly name: string
  /** Answers the last message, calling tools as needed, and streams the text as it is written. */
  runTurn<D>(request: TurnRequest<D>): AsyncGenerator<TurnEvent<D>>
}

/** The provider could not answer (down, timeout, quota, rejected request). Never carries provider details. */
export class AssistantModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssistantModelError'
  }
}
