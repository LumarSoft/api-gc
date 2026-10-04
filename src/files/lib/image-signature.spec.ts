import { detectImageType } from './image-signature'

const bytes = (...values: number[]): Buffer => Buffer.from(values)
const withAscii = (prefix: Buffer, text: string): Buffer => Buffer.concat([prefix, Buffer.from(text, 'latin1')])

describe('detectImageType', () => {
  it('recognizes jpeg, png, webp and avif by their first bytes', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))?.mimeType).toBe('image/jpeg')
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))?.mimeType).toBe('image/png')
    expect(detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))?.mimeType).toBe('image/webp')
    expect(detectImageType(withAscii(bytes(0, 0, 0, 0x1c), 'ftypavif'))?.extension).toBe('avif')
  })

  it('rejects other files even when they are named like an image', () => {
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectImageType(Buffer.from('%PDF-1.7'))).toBeNull()
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull()
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull()
    expect(detectImageType(Buffer.alloc(0))).toBeNull()
  })
})
