import type { ChatMessage } from '../assistant-model'

/**
 * A stored message: the text the customer saw and, for answers, the products shown as cards. `pageId`: for the
 * customer's messages, the product page they wrote it from.
 */
export interface StoredMessage {
  role: 'user' | 'assistant'
  text: string
  productIds: number[]
  pageId: number | null
}

/**
 * The conversation as the model reads it. Answers that showed cards say which products, with their price and stock
 * now, so "the cheapest of those" or "the first one" can be answered in the next turn without guessing. The customer's
 * messages say which product page they were written from: the customer moves around the store with the chat open, and
 * "this one" changes with them.
 */
export function chatHistory(
  messages: StoredMessage[],
  shown: Map<number, string>,
  pages: Map<number, string>,
): ChatMessage[] {
  return messages
    .map(message => {
      const cards = message.productIds.flatMap(id => shown.get(id) ?? [])
      const note =
        message.role === 'user'
          ? pageNote(message.pageId, pages)
          : cards.length
            ? `\n\n[Tarjetas mostradas, con precio y stock de ahora: ${cards.join('; ')}]`
            : ''
      return { role: message.role, text: `${message.text}${note}`.trim() }
    })
    .filter(message => message.text)
}

/**
 * Where a customer message was written. Every one says it, also outside product pages: otherwise the model assumes the
 * customer is still on the page of the message before.
 */
function pageNote(pageId: number | null, pages: Map<number, string>): string {
  if (pageId === null) return '\n\n[Escrito fuera de las fichas de productos]'
  const name = pages.get(pageId)
  return name ? `\n\n[Escrito desde la ficha de «${name}»]` : ''
}

/** `AssistantMessage.recommendedProducts` holds product ids, e.g. [12, 48]; anything else reads as none. */
export function storedProductIds(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : []
}
