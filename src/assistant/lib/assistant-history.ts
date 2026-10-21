import type { ChatMessage } from '../assistant-model'

/** A stored message: the text the customer saw and, for answers, the products shown as cards. */
export interface StoredMessage {
  role: 'user' | 'assistant'
  text: string
  productIds: number[]
}

/**
 * The conversation as the model reads it. Answers that showed cards say which products, with their price and stock
 * now, so "the cheapest of those" or "the first one" can be answered in the next turn without guessing.
 */
export function chatHistory(messages: StoredMessage[], shown: Map<number, string>): ChatMessage[] {
  return messages
    .map(message => {
      const cards = message.productIds.flatMap(id => shown.get(id) ?? [])
      const note = cards.length ? `\n\n[Tarjetas mostradas, con precio y stock de ahora: ${cards.join('; ')}]` : ''
      return { role: message.role, text: `${message.text}${note}`.trim() }
    })
    .filter(message => message.text)
}

/** `AssistantMessage.recommendedProducts` holds product ids, e.g. [12, 48]; anything else reads as none. */
export function storedProductIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : []
}
