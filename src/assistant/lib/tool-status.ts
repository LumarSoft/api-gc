/** Longest status line shown to the customer. */
const MAX_STATUS_LENGTH = 80

const FALLBACKS: Record<string, string> = {
  search_products: 'Buscando en el catálogo',
  get_product: 'Revisando la ficha del producto',
  show_products: 'Preparando las recomendaciones',
  contact_team: 'Preparando el mensaje para el equipo',
  record_unanswered_question: 'Anotando tu consulta para el equipo',
}

/**
 * What the customer reads while a tool runs ("Buscando tintas para la L3250…"). The model writes it in the tool's
 * `status` argument; anything missing or odd (markup, links, too long) falls back to a phrase of our own. Null for
 * unknown tools.
 */
export function toolStatus(name: string, args: unknown): string | null {
  const fallback = FALLBACKS[name]
  if (!fallback) return null
  const written = typeof args === 'object' && args !== null ? (args as { status?: unknown }).status : undefined
  return `${cleanStatus(written) ?? searchFallback(name, args) ?? fallback}…`
}

function cleanStatus(value: unknown): string | null {
  if (typeof value !== 'string' || /https?:|www\.|\//i.test(value)) return null
  const text = value
    .replace(/[*_#`[\]<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.…:;,!¡?¿\s]+$/u, '')
  if (text.length < 4 || text.length > MAX_STATUS_LENGTH) return null
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Without a written status, a search still says what it looks for. */
function searchFallback(name: string, args: unknown): string | null {
  if (name !== 'search_products' || typeof args !== 'object' || args === null) return null
  const text = (args as { text?: unknown }).text
  if (typeof text !== 'string' || !text.trim() || text.length > 40) return null
  return `Buscando «${text.trim()}» en el catálogo`
}
