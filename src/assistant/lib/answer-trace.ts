import { productSlugArgument, replyOptionsArgument, searchArguments } from './assistant-tools'

/** An answer that took this long is flagged to staff: with tools the median is about 12 s (measured 2026-10-21). */
export const SLOW_ANSWER_MS = 30_000
/** Tools kept per answer: a turn makes at most 6 calls of up to 4 tools. */
const MAX_TRACES = 24

/**
 * One tool the model used while answering, as staff read it in the admin. Stored in `AssistantMessage.toolCalls`;
 * only the fields of that tool are present.
 */
export type ToolTrace = {
  tool: string
  /** search_products: what it looked for. */
  text?: string | null
  category?: string | null
  use?: string | null
  maxPrice?: number | null
  sort?: string
  /** search_products: products found (0 = nothing). show_products: cards shown. */
  results?: number
  /** search_products: no product had every word; the results have some of them. */
  partial?: boolean
  /** get_product: the product asked for. */
  slug?: string | null
  /** show_products: slugs that are not published, so no card was shown for them. */
  missing?: string[]
  /** offer_replies: the quick replies shown under the question. */
  options?: string[]
  /** The tool answered with an error (unknown category, unpublished product…). */
  error?: boolean
}

/** What staff see about one tool call: its arguments and what it found, never the whole output. */
export function traceTool(name: string, args: unknown, output: unknown): ToolTrace {
  const result = isObject(output) ? output : {}
  const error = typeof result.error === 'string' ? { error: true } : {}
  switch (name) {
    case 'search_products': {
      const search = searchArguments(args)
      return {
        tool: name,
        text: search.text,
        category: search.category,
        use: search.use,
        maxPrice: search.maxPrice,
        sort: search.sort,
        ...(typeof result.total === 'number' ? { results: result.total, partial: result.partialMatch === true } : {}),
        ...error,
      }
    }
    case 'get_product':
      return { tool: name, slug: productSlugArgument(args), ...error }
    case 'offer_replies':
      return { tool: name, options: replyOptionsArgument(args), ...error }
    case 'show_products':
      return {
        tool: name,
        results: Array.isArray(result.shown) ? result.shown.length : 0,
        missing: Array.isArray(result.missing) ? result.missing.filter(slug => typeof slug === 'string') : [],
        ...error,
      }
    default:
      return { tool: name, ...error }
  }
}

/** The traces of an answer, capped, and how many of its product searches found nothing. */
export function answerTrace(traces: ToolTrace[]): { toolCalls: ToolTrace[]; emptySearches: number } {
  const toolCalls = traces.slice(0, MAX_TRACES)
  return {
    toolCalls,
    emptySearches: toolCalls.filter(trace => trace.tool === 'search_products' && trace.results === 0).length,
  }
}

/** `AssistantMessage.toolCalls` as written by `answerTrace`; anything else reads as none. */
export function storedTraces(value: unknown): ToolTrace[] {
  return Array.isArray(value)
    ? value.filter((trace): trace is ToolTrace => isObject(trace) && typeof trace.tool === 'string')
    : []
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
