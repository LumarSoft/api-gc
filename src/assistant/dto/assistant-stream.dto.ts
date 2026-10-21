import type { ProductSummaryDto } from '../../products/dto/product-response.dto'

/** A product card in the chat: the catalog card plus the variant to add to the cart when there is only one. */
export interface AssistantProductCardDto extends ProductSummaryDto {
  /** Null when the product has several options: the customer picks one on the product page. */
  variantId: number | null
}

/** Something the assistant shows besides its text. */
export type AssistantDisplay =
  | { type: 'products'; items: AssistantProductCardDto[] }
  /** Link that opens WhatsApp with the customer's message already written. */
  | { type: 'handoff'; url: string }

/** One line of the NDJSON stream of `POST /assistant/messages`. */
export type AssistantStreamEvent =
  /** First line of a new conversation: the token to send with the next messages. */
  | { type: 'conversation'; token: string }
  /** What the assistant is doing while the customer waits, e.g. "Buscando tintas para tu L3250…". Replaces the last one. */
  | { type: 'status'; text: string }
  | { type: 'text'; delta: string }
  | AssistantDisplay
  | { type: 'error'; message: string }
  /** Last line: the answer is complete (also after an error). */
  | { type: 'done' }
