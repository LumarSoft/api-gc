import { isBot, normalizeSearch } from './activity-rules'

describe('activity rules', () => {
  it('ignores crawlers, previews, headless browsers and requests without a user agent', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBot('WhatsApp/2.23.20.0')).toBe(true)
    expect(isBot('Mozilla/5.0 HeadlessChrome/120.0')).toBe(true)
    expect(isBot(undefined)).toBe(true)
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')).toBe(false)
  })

  it('normalizes searches so the same text counts once', () => {
    expect(normalizeSearch('  Tinta   EPSON ')).toBe('tinta epson')
    expect(normalizeSearch('x'.repeat(150))).toHaveLength(100)
  })
})
