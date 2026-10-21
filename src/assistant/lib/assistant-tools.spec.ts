import {
  ASSISTANT_TOOLS,
  assistantTools,
  contactArguments,
  MAX_SHOWN_PRODUCTS,
  productSlugArgument,
  replyOptionsArgument,
  searchArguments,
  shownSlugsArgument,
} from './assistant-tools'

describe('assistant tools', () => {
  it('declares strict schemas: every property required, nothing extra', () => {
    for (const tool of ASSISTANT_TOOLS) {
      const parameters = tool.parameters as { properties: object; required: string[]; additionalProperties: boolean }
      expect(parameters.additionalProperties).toBe(false)
      expect([...parameters.required].sort()).toEqual(Object.keys(parameters.properties).sort())
    }
  })

  it('offers contact_team only when a person can take over', () => {
    expect(assistantTools(true).map(tool => tool.name)).toContain('contact_team')
    expect(assistantTools(false).map(tool => tool.name)).not.toContain('contact_team')
  })

  it('reads search arguments defensively', () => {
    expect(
      searchArguments({
        text: ' L3250 ',
        category: null,
        use: 'uso-foto',
        max_price: 500000,
        on_sale: null,
        sort: null,
      }),
    ).toEqual({ text: 'L3250', category: null, use: 'uso-foto', maxPrice: 500000, onSale: false, sort: 'relevance' })
    expect(searchArguments({ category: 'DROP TABLE', max_price: -1, sort: 'cheapest' })).toMatchObject({
      category: null,
      maxPrice: null,
      sort: 'relevance',
    })
    expect(searchArguments(null)).toMatchObject({ text: null, onSale: false })
  })

  it('keeps only valid, distinct slugs to show, up to the limit', () => {
    expect(shownSlugsArgument({ slugs: ['a', 'a', 'B!', 'b', 'c', 'd', 'e'] })).toEqual(['a', 'b', 'c', 'd'])
    expect(shownSlugsArgument({ slugs: 'a' })).toEqual([])
    expect(MAX_SHOWN_PRODUCTS).toBe(4)
    expect(productSlugArgument({ slug: 'ecotank-l3250' })).toBe('ecotank-l3250')
    expect(productSlugArgument({ slug: '../etc' })).toBeNull()
  })

  it('keeps quick replies short, plain, distinct and at most four', () => {
    expect(
      replyOptionsArgument({
        options: [
          ' Para la  oficina ',
          'para la oficina',
          'Para el **hogar**',
          'x'.repeat(41),
          '',
          7,
          'Para fotos',
          'Para comercio',
          'Para textil',
        ],
      }),
    ).toEqual(['Para la oficina', 'Para el hogar', 'Para fotos', 'Para comercio'])
    expect(replyOptionsArgument({ options: 'Sí' })).toEqual([])
    expect(replyOptionsArgument(null)).toEqual([])
  })

  it('needs a message to contact the team', () => {
    expect(contactArguments({ reason: '', message: 'Hola, quiero un presupuesto' })).toEqual({
      reason: 'Consulta del asesor',
      message: 'Hola, quiero un presupuesto',
    })
    expect(contactArguments({ reason: 'Presupuesto', message: '  ' })).toBeNull()
  })
})
