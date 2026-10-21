import {
  buildVocabulary,
  catalogWords,
  closestTerm,
  editDistance,
  modelCode,
  rankSearch,
  searchForms,
  searchWords,
  type WordHit,
} from './product-search-rules'

describe('product search rules', () => {
  it('keeps the meaningful words of a question, in singular', () => {
    expect(searchWords('Quiero una impresora para la oficina')).toEqual(['impresora', 'oficina'])
    expect(searchWords('impresoras fotográficas')).toEqual(['impresora', 'fotográfica'])
    expect(searchWords('escáneres y papeles')).toEqual(['escáner', 'papel'])
    expect(searchWords('la más barata con wifi')).toEqual(['wifi'])
  })

  it('keeps model codes and SKUs whole, joining a code typed apart', () => {
    expect(searchWords('L3250')).toEqual(['l3250'])
    expect(searchWords('tinta T544 cyan')).toEqual(['tinta', 't544', 'cyan'])
    expect(searchWords('TM-T20IV-SP')).toEqual(['tm-t20iv-sp'])
    expect(searchWords('la L 3250 o la ES 400')).toEqual(['l3250', 'es400'])
    expect(searchWords('menos de 300 mil')).toEqual(['300', 'mil'])
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
    weight: strong ? 2 : 1,
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

  it('puts a word found in the name before one found in the summary or the category', () => {
    const at = (id: number, weight: number): WordHit => ({ id, weight, isFeatured: id === 2, publishedAt: null })
    expect(rankSearch([[at(1, 3), at(2, 2), at(3, 1)]], false).ids).toEqual([1, 2, 3])
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

  it('counts a swap of two letters as one edit', () => {
    expect(editDistance('ecotnak', 'ecotank')).toBe(1)
    expect(editDistance('epsom', 'epson')).toBe(1)
    expect(editDistance('impresra', 'impresora')).toBe(1)
    expect(editDistance('tinta', 'tinta')).toBe(0)
    expect(editDistance('plotter', 'papel')).toBeGreaterThan(2)
  })

  it('learns the catalog words, in singular, with how many products use them', () => {
    expect(catalogWords('Impresoras Multifuncionales EcoTank L3250 de 2 años')).toEqual([
      'impresora',
      'multifuncional',
      'ecotank',
      'año',
    ])
    const vocabulary = buildVocabulary(['Impresora EcoTank L3250', 'Impresora Fotográfica EcoTank L8050', 'Escáner'])
    expect(vocabulary.get('ecotank')).toEqual({ word: 'ecotank', weight: 2 })
    expect(vocabulary.get('fotografica')).toEqual({ word: 'fotográfica', weight: 1 })
  })

  it('corrects a misspelled word to the closest catalog word', () => {
    const vocabulary = buildVocabulary([
      'Impresora Multifuncional EcoTank L3250',
      'Impresora EcoTank L1250',
      'Botella de tinta Epson T544',
      'Escáner Epson',
      'Impresora de Sublimación SureColor F170',
    ])
    expect(closestTerm('ecotnak', vocabulary)).toBe('ecotank')
    expect(closestTerm('epsom', vocabulary)).toBe('epson')
    expect(closestTerm('impresra', vocabulary)).toBe('impresora')
    expect(closestTerm('escaner', vocabulary)).toBeNull()
    expect(closestTerm('sublimasion', vocabulary)).toBe('sublimación')
    // Short words, codes and words too far from any are left as typed.
    expect(closestTerm('tnta', vocabulary)).toBe('tinta')
    expect(closestTerm('tnt', vocabulary)).toBeNull()
    expect(closestTerm('l3260', vocabulary)).toBeNull()
    expect(closestTerm('heladera', vocabulary)).toBeNull()
  })
})
