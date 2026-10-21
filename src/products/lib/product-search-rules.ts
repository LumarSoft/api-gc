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

/** A catalog word and how many products use it, to prefer the common one between two equally close words. */
export type VocabularyTerm = { word: string; weight: number }
/** Catalog words by their folded form (no accents), as `searchWords` writes them. */
export type SearchVocabulary = Map<string, VocabularyTerm>

/** The words of a catalog text (a name, a category…) as a search would write them, for the vocabulary. */
export function catalogWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3 && /\p{L}/u.test(word) && !/\d/.test(word) && !STOP_WORDS.has(word))
    .map(singular)
  return [...new Set(words)]
}

/** The vocabulary of a set of catalog texts: each word with the number of texts that use it. */
export function buildVocabulary(texts: string[]): SearchVocabulary {
  const vocabulary: SearchVocabulary = new Map()
  for (const text of texts)
    for (const word of catalogWords(text)) {
      const key = fold(word)
      const term = vocabulary.get(key)
      vocabulary.set(key, { word: term?.word ?? word, weight: (term?.weight ?? 0) + 1 })
    }
  return vocabulary
}

/**
 * The catalog word a misspelled one most likely meant ("epsom" → "epson", "ecotnak" → "ecotank"): the closest by edit
 * distance (one change up to 6 letters, two from 7), the most used on a tie. Null for short words, numbers and model
 * codes (L3260 is not a typo of L3250), and for words the catalog already has.
 */
export function closestTerm(word: string, vocabulary: SearchVocabulary): string | null {
  const folded = fold(word)
  if (folded.length < 4 || /\d/.test(folded) || vocabulary.has(folded)) return null
  const max = folded.length <= 6 ? 1 : 2
  let best: { term: VocabularyTerm; distance: number } | null = null
  for (const [key, term] of vocabulary) {
    if (Math.abs(key.length - folded.length) > max) continue
    const distance = editDistance(folded, key)
    if (distance > max) continue
    if (!best || distance < best.distance || (distance === best.distance && term.weight > best.term.weight))
      best = { term, distance }
  }
  return best?.term.word ?? null
}

/** Edits between two words, a swap of two neighbor letters counting as one (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
    }
  return rows[a.length][b.length]
}

function singular(word: string): string {
  if (word.length > 4 && /[^aeiou]es$/.test(word) && !/(as|es|is|os|us)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && /[aeiou]s$/.test(word)) return word.slice(0, -1)
  return word
}

/** The word without accents, as the database collation compares it. */
export function fold(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Where a searched word was found in a product, best first. */
export const HIT_WEIGHT = {
  /** The name, a SKU or the model code: what the customer most likely means. */
  name: 3,
  /** The summary, the category, the brand or a use. */
  related: 2,
  /** Only in a specification value. */
  specification: 1,
} as const

/**
 * Added to a word's weight when it also names the product's category or its parent: the word says what the product
 * is. "tinta" lists the ink (category "Tintas y consumibles") before a printer named "de tinta", even when the ink's
 * name lacks the word.
 */
export const CATEGORY_BONUS = 2

/** A product found for one searched word, and how strongly (`HIT_WEIGHT`, plus `CATEGORY_BONUS`). */
export interface WordHit {
  id: number
  isFeatured: boolean
  publishedAt: Date | null
  weight: number
}

export interface RankedSearch {
  /** Matching product ids, best first. */
  ids: number[]
  /** False when no product had every word and `ids` holds the ones with some of them. */
  complete: boolean
}

/**
 * Orders the products found for each word: those with every word first (none with only some, unless `partial`), then
 * more words found, found in better places (`HIT_WEIGHT`, `CATEGORY_BONUS`), and the catalog's own order (featured,
 * newest).
 */
export function rankSearch(hitsPerWord: WordHit[][], partial: boolean): RankedSearch {
  const found = new Map<number, { hit: WordHit; words: number; weight: number }>()
  for (const hits of hitsPerWord) {
    const best = new Map<number, WordHit>()
    for (const hit of hits) if ((best.get(hit.id)?.weight ?? 0) < hit.weight) best.set(hit.id, hit)
    for (const hit of best.values()) {
      const entry = found.get(hit.id) ?? { hit, words: 0, weight: 0 }
      entry.words += 1
      entry.weight += hit.weight
      found.set(hit.id, entry)
    }
  }
  const all = [...found.values()]
  const complete = all.filter(entry => entry.words === hitsPerWord.length)
  const chosen = complete.length || !partial || hitsPerWord.length < 2 ? complete : all
  chosen.sort(
    (a, b) =>
      b.words - a.words ||
      b.weight - a.weight ||
      Number(b.hit.isFeatured) - Number(a.hit.isFeatured) ||
      (b.hit.publishedAt?.getTime() ?? 0) - (a.hit.publishedAt?.getTime() ?? 0) ||
      b.hit.id - a.hit.id,
  )
  return { ids: chosen.map(entry => entry.hit.id), complete: chosen === complete }
}
