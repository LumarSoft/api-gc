/** Days of searches that make one "popular". */
export const POPULAR_SEARCH_DAYS = 30
/** Different visitors a search needs before it is suggested to everyone: one person's text is never shown to others. */
export const POPULAR_SEARCH_MIN_VISITORS = 3
export const POPULAR_SEARCHES = 8

/**
 * Whether a search can be suggested to other visitors. Searches are free text: one that looks like personal data (an
 * email, a phone or document number) or is long enough to be a sentence is left out, even if several people typed it.
 */
export function isShareableSearch(query: string): boolean {
  return query.length >= 2 && query.length <= 40 && !/@|\d{6,}/.test(query)
}
