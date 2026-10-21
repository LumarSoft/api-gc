import { answerTrace, storedTraces, traceTool } from './answer-trace'

describe('answer trace', () => {
  it('keeps what a search looked for and how many products it found', () => {
    expect(
      traceTool(
        'search_products',
        { text: ' wifi ', max_price: 300000, sort: 'price-asc', status: 'x' },
        {
          total: 22,
          partialMatch: false,
          products: [{ slug: 'a' }],
        },
      ),
    ).toEqual({
      tool: 'search_products',
      text: 'wifi',
      category: null,
      use: null,
      maxPrice: 300000,
      sort: 'price-asc',
      results: 22,
      partial: false,
    })
  })

  it('marks tools that answered with an error', () => {
    expect(traceTool('search_products', { category: 'nada' }, { error: 'No existe la categoría' })).toMatchObject({
      category: 'nada',
      error: true,
    })
    expect(traceTool('get_product', { slug: 'ecotank-l3250' }, { error: 'No hay un producto' })).toEqual({
      tool: 'get_product',
      slug: 'ecotank-l3250',
      error: true,
    })
    expect(traceTool('get_product', { slug: 'ecotank-l3250' }, { name: 'L3250' })).toEqual({
      tool: 'get_product',
      slug: 'ecotank-l3250',
    })
  })

  it('keeps the quick replies offered', () => {
    expect(traceTool('offer_replies', { options: ['Hogar', ' Oficina '] }, { shown: ['Hogar', 'Oficina'] })).toEqual({
      tool: 'offer_replies',
      options: ['Hogar', 'Oficina'],
    })
    expect(traceTool('offer_replies', { options: ['Hogar'] }, { error: 'Pasá de 2 a 4' })).toEqual({
      tool: 'offer_replies',
      options: ['Hogar'],
      error: true,
    })
  })

  it('counts the cards shown and the slugs that had none', () => {
    expect(traceTool('show_products', { slugs: ['a', 'b'] }, { shown: ['A'], missing: ['b'] })).toEqual({
      tool: 'show_products',
      results: 1,
      missing: ['b'],
    })
  })

  it('counts the searches that found nothing', () => {
    const traces = [
      traceTool('search_products', { text: 'plotter' }, { total: 0, partialMatch: false }),
      traceTool('search_products', { text: 'wifi' }, { total: 3, partialMatch: false }),
      traceTool('search_products', { category: 'x' }, { error: 'No existe' }),
    ]
    expect(answerTrace(traces).emptySearches).toBe(1)
    expect(answerTrace(Array.from({ length: 30 }, () => traces[0])).toolCalls).toHaveLength(24)
  })

  it('reads back only well-formed traces', () => {
    expect(storedTraces([{ tool: 'get_product', slug: 'a' }, 'x', { slug: 'b' }])).toEqual([
      { tool: 'get_product', slug: 'a' },
    ])
    expect(storedTraces(null)).toEqual([])
  })
})
