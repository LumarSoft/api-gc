import { RepeatedMessages } from './repeated-messages'

const stream = (filter: RepeatedMessages, id: string, deltas: string[]): string => {
  const shown = deltas.map(delta => filter.next(id, delta)).join('')
  filter.finish()
  return shown
}

describe('RepeatedMessages', () => {
  it('drops a message that repeats an earlier one word for word', () => {
    const filter = new RepeatedMessages()
    expect(stream(filter, 'a', ['¿Para qué ', 'la necesitás?'])).toBe('¿Para qué la necesitás?')
    expect(stream(filter, 'b', ['¿Para qué', ' la necesitás?', ' '])).toBe('')
  })

  it('lets a message through, held part included, as soon as it differs', () => {
    const filter = new RepeatedMessages()
    stream(filter, 'a', ['¿Para qué la necesitás?'])
    const b = ['¿Para qué ', 'tipo de fotos', ' la querés?'].map(delta => filter.next('b', delta))
    expect(b).toEqual(['', '¿Para qué tipo de fotos', ' la querés?'])
  })

  it('compares each message with every earlier one, and starts over for each answer', () => {
    const filter = new RepeatedMessages()
    stream(filter, 'a', ['Te mostramos tres opciones.'])
    stream(filter, 'b', ['¿Cuál te sirve más?'])
    expect(stream(filter, 'c', ['Te mostramos tres opciones.'])).toBe('')
    expect(stream(new RepeatedMessages(), 'a', ['Te mostramos tres opciones.'])).toBe('Te mostramos tres opciones.')
  })
})
