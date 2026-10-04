export interface ImageType {
  mimeType: string
  extension: string
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte)

const ascii = (buffer: Buffer, start: number, end: number): string => buffer.subarray(start, end).toString('latin1')

/**
 * Detects the real image type from the file's first bytes ("magic numbers"). The extension and the Content-Type sent
 * by the browser are ignored: both are chosen by the client. Returns null for anything that is not an accepted image.
 */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', extension: 'png' }
  }
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' }
  }
  const avifBrand = ascii(buffer, 4, 12)
  if (avifBrand === 'ftypavif' || avifBrand === 'ftypavis') return { mimeType: 'image/avif', extension: 'avif' }
  return null
}
