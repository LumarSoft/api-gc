import { assistantInstructions, type CatalogMap, type StoreFacts } from './assistant-instructions'

const catalog: CatalogMap = {
  categories: [
    { slug: 'impresoras', name: 'Impresoras', parent: null, products: 3 },
    { slug: 'impresoras-hogar', name: 'Para el hogar', parent: 'Impresoras', products: 3 },
    { slug: 'papeles', name: 'Papeles', parent: null, products: 0 },
  ],
  uses: [{ slug: 'uso-foto', name: 'Fotografía' }],
  brands: ['Epson'],
}
const facts: StoreFacts = {
  localDelivery: { flatRate: '$ 3.500', freeFrom: '$ 80.000' },
  carrierShipping: true,
  onlinePayment: false,
  reservationHours: 24,
  handoff: false,
}
const turn = { frequentCustomer: false, signedIn: false, viewing: null, today: '2026-10-20' }

describe('assistant instructions', () => {
  it('limits the assistant to the store and forbids inventing data', () => {
    const text = assistantInstructions(facts, catalog, turn)
    expect(text).toMatch(/fuera de tu alcance/)
    expect(text).toMatch(/Nunca escribas código/)
    expect(text).toMatch(/Nunca los inventes/)
  })

  it('keeps the copy rules: plural, no "mayorista", the customer\'s language', () => {
    const text = assistantInstructions(facts, catalog, turn)
    expect(text).toContain('La tienda no usa la palabra "mayorista"')
    expect(text).toContain('nunca "te muestro"')
    expect(text).toContain('respondé en ese idioma')
  })

  it('shows the closest options instead of stopping at "no hay"', () => {
    const text = assistantInstructions(facts, catalog, turn)
    expect(text).toContain('no te quedes en el "no hay"')
    expect(text).toContain('mostrá el equipo Epson que resuelve lo mismo')
  })

  it('says where the shipping cost is instead of asking for the postal code', () => {
    const text = assistantInstructions(facts, catalog, turn)
    expect(text).toContain('Desde el chat no se puede cotizar: no pidas el código postal')
    expect(text).toContain('El costo de un envío no es un dato faltante')
  })

  it('states what the store offers today', () => {
    const text = assistantInstructions(facts, catalog, turn)
    expect(text).toContain('Entrega a domicilio en Rosario: $ 3.500, gratis en compras desde $ 80.000.')
    expect(text).toContain('Medio de pago: a coordinar con el local')
    expect(text).toContain('reservados 24 horas.')
    expect(assistantInstructions({ ...facts, onlinePayment: true }, catalog, turn)).toContain(
      'reservados 24 horas; con Mercado Pago, 1 hora.',
    )
    const off = assistantInstructions({ ...facts, localDelivery: null, carrierShipping: false }, catalog, turn)
    expect(off).toContain('Entrega a domicilio en Rosario: todavía no está disponible.')
    expect(off).toContain('Envíos al resto del país: todavía no están disponibles')
  })

  it('offers a person only when there is a WhatsApp number', () => {
    expect(assistantInstructions(facts, catalog, turn)).toContain('No lo ofrezcas ni digas que intentaste derivar')
    expect(assistantInstructions({ ...facts, handoff: true }, catalog, turn)).toContain(
      'por WhatsApp, con contact_team',
    )
  })

  it('lists the categories with products and the uses', () => {
    const text = assistantInstructions(facts, catalog, turn)
    expect(text).toContain('- impresoras-hogar: Impresoras › Para el hogar (3)')
    expect(text).not.toContain('- papeles:')
    expect(text).toContain('- uso-foto: Fotografía')
  })

  it('ends with who is asking and from which page, after the stable text', () => {
    const text = assistantInstructions(facts, catalog, {
      ...turn,
      frequentCustomer: true,
      signedIn: true,
      viewing: { name: 'EcoTank L3250', slug: 'ecotank-l3250' },
    })
    expect(text.indexOf('# Esta conversación')).toBeGreaterThan(text.indexOf('# Mapa del catálogo'))
    expect(text).toContain('Cliente frecuente aprobado')
    expect(text).toContain('Ahora está en la ficha de «EcoTank L3250» (slug ecotank-l3250).')
    expect(assistantInstructions(facts, catalog, turn)).toContain('Ahora no está en la ficha de ningún producto.')
    expect(text).toContain('Que cambie de producto es normal')
  })
})
