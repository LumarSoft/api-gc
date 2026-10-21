import { chatHistory, type StoredMessage } from './assistant-history'

describe('assistant history', () => {
  const pages = new Map([
    [3, 'EcoTank L3250'],
    [9, 'EcoTank L8180'],
  ])
  const shown = new Map([[3, 'EcoTank L3250 (slug ecotank-l3250): $ 419.999, en stock']])

  it('says which product page each customer message was written from', () => {
    const messages: StoredMessage[] = [
      { role: 'user', text: 'me interesa esta', productIds: [], pageId: 3 },
      { role: 'assistant', text: 'Te la mostramos.', productIds: [3], pageId: null },
      { role: 'user', text: '¿y esta?', productIds: [], pageId: 9 },
      { role: 'user', text: '¿y ahora?', productIds: [], pageId: null },
    ]
    expect(chatHistory(messages, shown, pages).map(message => message.text)).toEqual([
      'me interesa esta\n\n[Escrito desde la ficha de «EcoTank L3250»]',
      'Te la mostramos.\n\n[Tarjetas mostradas, con precio y stock de ahora: EcoTank L3250 (slug ecotank-l3250): $ 419.999, en stock]',
      '¿y esta?\n\n[Escrito desde la ficha de «EcoTank L8180»]',
      '¿y ahora?\n\n[Escrito fuera de las fichas de productos]',
    ])
  })

  it('leaves out answers that wrote nothing', () => {
    const messages: StoredMessage[] = [
      { role: 'user', text: 'hola', productIds: [], pageId: null },
      { role: 'assistant', text: '', productIds: [], pageId: null },
    ]
    expect(chatHistory(messages, shown, pages)).toEqual([
      { role: 'user', text: 'hola\n\n[Escrito fuera de las fichas de productos]' },
    ])
  })
})
