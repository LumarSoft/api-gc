/**
 * Words that say nothing about the product ("una impresora para la oficina" → "impresora", "oficina"), including how
 * good or cheap it should be ("la más barata"): no product is named that way, and price has its own sort.
 */
const STOP_WORDS = new Set([
  ...'a al algo alguna alguno busco con como cual de del el en es esa ese esta este la las lo los'.split(' '),
  ...'me mi mis necesito o para por que quiero se su sus tiene un una uno unos unas y'.split(' '),
  ...'más mas menos muy mejor buena bueno barata barato económica económico'.split(' '),
])
/** Searched words are few: more would only narrow the results to nothing. */
const MAX_WORDS = 5

/** Spellings customers type apart that are one word for the search ("wi fi" → "wifi"). */
const JOINED = [
  { pattern: /\bwi[\s-]+fi\b/g, word: 'wifi' },
  { pattern: /\bdoble\s+(faz|cara)\b/g, word: 'duplex' },
]

/**
 * Words customers use for what the catalog names otherwise. A word starting with one of `starts` also searches
 * `forms` (a fragment like "inalámbric" matches "inalámbrica" and "inalámbrico"; the collation ignores accents).
 */
const SYNONYMS: { starts: string[]; forms: string[] }[] = [
  { starts: ['wifi', 'wi-fi', 'inalambric', 'wireless'], forms: ['wifi', 'wi-fi', 'inalámbric'] },
  {
    starts: ['ticket', 'comandera', 'recibo'],
    forms: ['ticket', 'recibo', 'comandera', 'punto de venta', 'puntos de venta'],
  },
  { starts: ['plotter', 'ploter'], forms: ['plotter', 'gran formato'] },
  { starts: ['multifuncion'], forms: ['multifunci'] },
  { starts: ['escaner', 'escanea', 'escanee', 'scanner'], forms: ['escáner', 'escanea'] },
  { starts: ['duplex', 'dúplex'], forms: ['dúplex', 'doble faz'] },
  { starts: ['sublim'], forms: ['sublim'] },
  { starts: ['cartucho'], forms: ['cartucho', 'tinta'] },
  { starts: ['remera', 'textil'], forms: ['remera', 'textil', 'sublim'] },
]

/**
 * Words to look for in a free-text search, without stop words and in singular ("impresoras fotográficas" →
 * "impresora", "fotográfica"). A model code typed apart is joined ("L 3250" → "l3250").
 */
export function searchWords(text: string): string[] {
  // Before lowercasing: "ES 400" is a model, "es 400" may be a sentence.
  let normalized = text
    .replace(/\b(\p{L}{1,3})[\s-]+(\d{2,})/gu, (match, letters: string, digits: string) =>
      STOP_WORDS.has(letters) ? match : `${letters}${digits}`,
    )
    .toLowerCase()
  for (const { pattern, word } of JOINED) normalized = normalized.replace(pattern, word)
  const words = normalized
    .split(/[^\p{L}\p{N}-]+/u)
    .map(word => word.replace(/^-+|-+$/g, ''))
    .filter(word => word.length > 1 && !STOP_WORDS.has(word))
    .map(singular)
  return [...new Set(words)].slice(0, MAX_WORDS)
}

/** The texts a word is searched as: the word itself and the catalog's names for it. */
export function searchForms(word: string): string[] {
  const folded = fold(word)
  const synonyms = SYNONYMS.filter(group => group.starts.some(start => folded.startsWith(fold(start))))
  return [...new Set([word, ...synonyms.flatMap(group => group.forms)])]
}

/**
 * A model code or SKU without its separators ("L-3250" → "l3250", "TM-T20" → "tmt20"), compared against names and
 * SKUs written either way. Null for plain words.
 */
export function modelCode(word: string): string | null {
  const code = word.toLowerCase().replace(/[^a-z0-9]/g, '')
  return code.length >= 3 && /[a-z]/.test(code) && /\d/.test(code) ? code : null
}

function singular(word: string): string {
  if (word.length > 4 && /[^aeiou]es$/.test(word) && !/(as|es|is|os|us)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && /[aeiou]s$/.test(word)) return word.slice(0, -1)
  return word
}

function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '')
}

/** A product found for one searched word. `strong`: in its name, summary, SKU, category, brand or a use. */
export interface WordHit {
  id: number
  isFeatured: boolean
  publishedAt: Date | null
  strong: boolean
}

export interface RankedSearch {
  /** Matching product ids, best first. */
  ids: number[]
  /** False when no product had every word and `ids` holds the ones with some of them. */
  complete: boolean
}

/**
 * Orders the products found for each word: those with every word first (none with only some, unless `partial`), then
 * more words found, more of them in strong fields, and the catalog's own order (featured, newest).
 */
export function rankSearch(hitsPerWord: WordHit[][], partial: boolean): RankedSearch {
  const found = new Map<number, { hit: WordHit; words: number; strong: number }>()
  for (const hits of hitsPerWord) {
    const best = new Map<number, WordHit>()
    for (const hit of hits) if (!best.get(hit.id)?.strong) best.set(hit.id, hit)
    for (const hit of best.values()) {
      const entry = found.get(hit.id) ?? { hit, words: 0, strong: 0 }
      entry.words += 1
      if (hit.strong) entry.strong += 1
      found.set(hit.id, entry)
    }
  }
  const all = [...found.values()]
  const complete = all.filter(entry => entry.words === hitsPerWord.length)
  const chosen = complete.length || !partial || hitsPerWord.length < 2 ? complete : all
  chosen.sort(
    (a, b) =>
      b.words - a.words ||
      b.strong - a.strong ||
      Number(b.hit.isFeatured) - Number(a.hit.isFeatured) ||
      (b.hit.publishedAt?.getTime() ?? 0) - (a.hit.publishedAt?.getTime() ?? 0) ||
      b.hit.id - a.hit.id,
  )
  return { ids: chosen.map(entry => entry.hit.id), complete: chosen === complete }
}
