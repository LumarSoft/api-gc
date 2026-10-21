import { modelCode, rankSearch, searchForms, searchWords, type WordHit } from './product-search-rules'

describe('product search rules', () => {
  it('keeps the meaningful words of a question, in singular', () => {
    expect(searchWords('Quiero una impresora para la oficina')).toEqual(['impresora', 'oficina'])
    expect(searchWords('impresoras fotográficas')).toEqual(['impresora', 'fotográfica'])
    expect(searchWords('escáneres y papeles')).toEqual(['escáner', 'papel'])
  })

  it('keeps model codes and SKUs whole, joining a code typed apart', () => {
    expect(searchWords('L3250')).toEqual(['l3250'])
    expect(searchWords('tinta T544 cyan')).toEqual(['tinta', 't544', 'cyan'])
    expect(searchWords('TM-T20IV-SP')).toEqual(['tm-t20iv-sp'])
    expect(searchWords('la L 3250 o la ES 400')).toEqual(['l3250', 'es400'])
    expect(searchWords('menos de 300 mil')).toEqual(['meno', '300', 'mil'])
    expect(searchWords('es 400 mil')).toEqual(['400', 'mil'])
  })

  it('reads "wi fi" and "doble faz" as one word', () => {
    expect(searchWords('impresora wi fi doble faz')).toEqual(['impresora', 'wifi', 'duplex'])
    expect(searchWords('con Wi-Fi')).toEqual(['wifi'])
  })

  it('searches at most five distinct words', () => {
    expect(searchWords('a b c')).toEqual([])
    expect(searchWords('wifi wifi duplex color a3 escaner fotos')).toEqual(['wifi', 'duplex', 'color', 'a3', 'escaner'])
  })

  it('also searches the names the catalog uses for a word', () => {
    expect(searchForms('wifi')).toEqual(['wifi', 'wi-fi', 'inalámbric'])
    expect(searchForms('inalámbrica')).toEqual(['inalámbrica', 'wifi', 'wi-fi', 'inalámbric'])
    expect(searchForms('comandera')).toContain('recibo')
    expect(searchForms('plotter')).toContain('gran formato')
    expect(searchForms('multifuncional')).toEqual(['multifuncional', 'multifunci'])
    expect(searchForms('escanee')).toContain('escáner')
    expect(searchForms('impresora')).toEqual(['impresora'])
  })

  it('compares model codes without their separators', () => {
    expect(modelCode('l-3250')).toBe('l3250')
    expect(modelCode('tm-t20iv-sp')).toBe('tmt20ivsp')
    expect(modelCode('es400')).toBe('es400')
    expect(modelCode('a3')).toBeNull()
    expect(modelCode('impresora')).toBeNull()
    expect(modelCode('3250')).toBeNull()
  })

  const hit = (id: number, strong: boolean, isFeatured = false): WordHit => ({
    id,
    strong,
    isFeatured,
    publishedAt: new Date(2026, 0, id),
  })

  it('ranks products with every word first, preferring strong fields and then the catalog order', () => {
    const ranked = rankSearch(
      [
        [hit(1, true), hit(2, false), hit(3, true), hit(4, true, true)],
        [hit(1, false), hit(2, false), hit(3, true), hit(4, true, true)],
      ],
      true,
    )
    expect(ranked).toEqual({ ids: [4, 3, 1, 2], complete: true })
  })

  it('counts a product once per word, by its best field', () => {
    expect(rankSearch([[hit(1, false), hit(1, true), hit(2, true)]], false).ids).toEqual([2, 1])
  })

  it('falls back to products with some of the words only when asked to', () => {
    const hits = [[hit(1, true)], [hit(2, true), hit(3, true)], [hit(3, false)]]
    expect(rankSearch(hits, false)).toEqual({ ids: [], complete: true })
    expect(rankSearch(hits, true)).toEqual({ ids: [3, 2, 1], complete: false })
    expect(rankSearch([[]], true)).toEqual({ ids: [], complete: true })
  })
})
