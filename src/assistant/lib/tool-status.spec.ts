import { toolStatus } from './tool-status'

describe('tool status', () => {
  it('shows what the model says it is doing, cleaned up', () => {
    expect(toolStatus('search_products', { status: 'buscando tintas para tu L3250.' })).toBe(
      'Buscando tintas para tu L3250…',
    )
    expect(toolStatus('get_product', { status: '**Revisando** la ficha de la `L8180`…' })).toBe(
      'Revisando la ficha de la L8180…',
    )
  })

  it('falls back to a phrase of its own when the status is missing or odd', () => {
    expect(toolStatus('get_product', {})).toBe('Revisando la ficha del producto…')
    expect(toolStatus('get_product', { status: 'Mirá https://evil.example' })).toBe('Revisando la ficha del producto…')
    expect(toolStatus('show_products', { status: 'x'.repeat(81) })).toBe('Preparando las recomendaciones…')
    expect(toolStatus('contact_team', null)).toBe('Preparando el mensaje para el equipo…')
  })

  it('names what a search looks for when the model did not say it', () => {
    expect(toolStatus('search_products', { text: 'T544' })).toBe('Buscando «T544» en el catálogo…')
    expect(toolStatus('search_products', { text: null, category: 'impresoras' })).toBe('Buscando en el catálogo…')
  })

  it('says nothing for unknown tools', () => {
    expect(toolStatus('delete_everything', { status: 'Borrando' })).toBeNull()
  })
})
