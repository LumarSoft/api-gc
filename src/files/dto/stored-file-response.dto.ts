export class StoredFileResponseDto {
  id: number
  /** Public URL, ready for <img src>. */
  url: string
  originalName: string
  mimeType: string
  sizeBytes: number
}
