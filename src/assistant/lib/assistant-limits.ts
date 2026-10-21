/** Cost and abuse limits of the assistant. Token limits come from the environment; the rest are technical bounds. */
export interface AssistantLimits {
  /** Per model call, reasoning included. */
  maxOutputTokens: number
  /** Input + output tokens of one conversation; past it the customer starts a new one. */
  conversationTokens: number
  /** Input + output tokens of all conversations in one Argentine day; past it the assistant pauses until tomorrow. */
  dailyTokens: number
}

/** Customer messages per conversation. */
export const MAX_CUSTOMER_MESSAGES = 40
/** Previous messages the model reads; older ones are left out to keep each call small. */
export const HISTORY_MESSAGES = 16
/**
 * Model calls per answer. A consumable question takes search → sheet → search → sheet, then the cards and the answer:
 * with fewer steps the last one can only write text and the cards are lost.
 */
export const MAX_TURN_STEPS = 6

const DEFAULTS: AssistantLimits = {
  maxOutputTokens: 2_000,
  conversationTokens: 400_000,
  dailyTokens: 5_000_000,
}

const ENV_KEYS: Record<keyof AssistantLimits, string> = {
  maxOutputTokens: 'ASSISTANT_MAX_OUTPUT_TOKENS',
  conversationTokens: 'ASSISTANT_CONVERSATION_TOKEN_LIMIT',
  dailyTokens: 'ASSISTANT_DAILY_TOKEN_LIMIT',
}

/** Positive integers from the environment; empty or invalid values use the default. */
export function assistantLimits(read: (key: string) => string | undefined): AssistantLimits {
  const value = (key: keyof AssistantLimits): number => {
    const parsed = Number(read(ENV_KEYS[key])?.trim())
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULTS[key]
  }
  return {
    maxOutputTokens: value('maxOutputTokens'),
    conversationTokens: value('conversationTokens'),
    dailyTokens: value('dailyTokens'),
  }
}

/** Why the conversation cannot take another message, or null. */
export function conversationLimitProblem(
  usage: { tokens: number; customerMessages: number },
  limits: AssistantLimits,
): string | null {
  if (usage.tokens >= limits.conversationTokens || usage.customerMessages >= MAX_CUSTOMER_MESSAGES)
    return 'Esta conversación llegó a su límite. Empezá una nueva para seguir consultando.'
  return null
}

/** WhatsApp number in international format, digits only (e.g. 5493415550000); null when missing or malformed. */
export function whatsappNumber(value: string | undefined): string | null {
  const digits = value?.replace(/[\s+()-]/g, '') ?? ''
  return /^\d{8,15}$/.test(digits) ? digits : null
}

/** Link that opens a WhatsApp chat with the store, with the customer's message already written. */
export function whatsappLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}
