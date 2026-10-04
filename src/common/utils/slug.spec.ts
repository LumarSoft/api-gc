import { slugify, slugOwnership } from './slug'

describe('slug', () => {
  it('builds url-safe slugs from Spanish names', () => {
    expect(slugify('Papeles & Sustratos fotográficos')).toBe('papeles-sustratos-fotograficos')
    expect(slugify('  Sublimación / Textil  ')).toBe('sublimacion-textil')
    expect(slugify('Año 2026')).toBe('ano-2026')
    expect(slugify('¡!')).toBe('')
  })

  it('decides whether a slug is free, reusable from an archived row, or taken', () => {
    const archived = { id: 4, deletedAt: new Date() }
    const active = { id: 4, deletedAt: null }
    expect(slugOwnership(null, null)).toBe('free')
    expect(slugOwnership(active, 4)).toBe('free')
    expect(slugOwnership(archived, null)).toBe('restore')
    expect(slugOwnership(archived, 9)).toBe('conflict')
    expect(slugOwnership(active, null)).toBe('conflict')
    expect(slugOwnership(active, 9)).toBe('conflict')
  })
})
