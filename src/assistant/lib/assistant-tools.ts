import type { ToolDefinition } from '../assistant-model'

export const SEARCH_SORTS = ['relevance', 'price-asc', 'price-desc'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

/** Most cards the assistant shows at once: a short list is easier to choose from. */
export const MAX_SHOWN_PRODUCTS = 4

export interface SearchArguments {
  text: string | null
  category: string | null
  use: string | null
  maxPrice: number | null
  onSale: boolean
  sort: SearchSort
}

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description })

/** The tools the model can call. Descriptions are written for the model, in the language it answers in. */
export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: 'search_products',
    description:
      'Busca productos publicados en la tienda, con el precio para este cliente. Usala antes de recomendar o ' +
      'nombrar cualquier producto. Para necesidades ("para fotos", "para la oficina") filtrá por categoría o uso; ' +
      'usá text para modelos, códigos o palabras puntuales.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'category', 'use', 'max_price', 'on_sale', 'sort'],
      properties: {
        text: nullable('string', 'Modelo, código o palabras clave, por ejemplo "L3250", "T544" o "escáner dúplex".'),
        category: nullable('string', 'Slug de una categoría del mapa del catálogo (incluye sus subcategorías).'),
        use: nullable('string', 'Slug de un uso del mapa del catálogo.'),
        max_price: nullable('number', 'Precio máximo en pesos argentinos.'),
        on_sale: nullable('boolean', 'true para ver solo productos en oferta.'),
        sort: {
          type: ['string', 'null'],
          enum: [...SEARCH_SORTS, null],
          description: 'Orden de los resultados. Por defecto, los destacados primero.',
        },
      },
    },
  },
  {
    name: 'get_product',
    description:
      'Ficha completa de un producto: descripción, especificaciones, opciones con su precio y stock, garantía y ' +
      'productos compatibles. Usala para comparar o para responder dudas técnicas.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['slug'],
      properties: { slug: { type: 'string', description: 'Slug del producto, tal como lo devolvió search_products.' } },
    },
  },
  {
    name: 'show_products',
    description:
      'Muestra al cliente tarjetas de producto con foto, nombre, precio, stock, link a la ficha y botón para ' +
      `agregar al carrito. Usala cada vez que recomiendes productos puntuales, con hasta ${MAX_SHOWN_PRODUCTS}, ` +
      'en orden de preferencia.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['slugs'],
      properties: {
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description: `De 1 a ${MAX_SHOWN_PRODUCTS} slugs de productos.`,
        },
      },
    },
  },
  {
    name: 'contact_team',
    description:
      'Ofrece al cliente un botón para seguir la consulta con una persona del equipo por WhatsApp. Usala si lo ' +
      'pide, si necesita algo que no se resuelve en la tienda online (presupuestos por cantidad, servicio técnico, ' +
      'un pedido ya hecho) o si no pudiste resolver su consulta con los datos que tenés.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['reason', 'message'],
      properties: {
        reason: { type: 'string', description: 'Motivo, en pocas palabras, para el equipo.' },
        message: {
          type: 'string',
          description:
            'Mensaje que el cliente le va a mandar al equipo, en primera persona y en una o dos frases, ' +
            'por ejemplo "Hola, quiero un presupuesto por 10 impresoras L3250 para mi empresa."',
        },
      },
    },
  },
  {
    name: 'record_unanswered_question',
    description:
      'Anota una pregunta del cliente que no pudiste responder porque falta el dato en la tienda, para que el ' +
      'equipo lo complete. No la uses para preguntas fuera de tema.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['question'],
      properties: { question: { type: 'string', description: 'La pregunta, resumida en una frase.' } },
    },
  },
]

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/** Slugs of the catalog: lowercase letters, digits and dashes. Anything else is ignored. */
const slug = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-z0-9-]{1,160}$/.test(value.trim()) ? value.trim() : null

export function searchArguments(args: unknown): SearchArguments {
  const input = isObject(args) ? args : {}
  const maxPrice = typeof input.max_price === 'number' && input.max_price > 0 ? input.max_price : null
  return {
    text: text(input.text, 100),
    category: slug(input.category),
    use: slug(input.use),
    maxPrice,
    onSale: input.on_sale === true,
    sort: SEARCH_SORTS.find(sort => sort === input.sort) ?? 'relevance',
  }
}

export function productSlugArgument(args: unknown): string | null {
  return isObject(args) ? slug(args.slug) : null
}

export function shownSlugsArgument(args: unknown): string[] {
  const values = isObject(args) && Array.isArray(args.slugs) ? args.slugs : []
  const slugs = values.map(slug).filter((value): value is string => value !== null)
  return [...new Set(slugs)].slice(0, MAX_SHOWN_PRODUCTS)
}

export function contactArguments(args: unknown): { reason: string; message: string } | null {
  if (!isObject(args)) return null
  const message = text(args.message, 500)
  return message ? { reason: text(args.reason, 255) ?? 'Consulta del asesor', message } : null
}

export function questionArgument(args: unknown): string | null {
  return isObject(args) ? text(args.question, 1000) : null
}
