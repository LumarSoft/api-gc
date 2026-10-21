export class PopularSearchesDto {
  /** Most searched first, as stored (trimmed, lowercased). Empty until enough visitors searched. */
  searches: string[]
}
