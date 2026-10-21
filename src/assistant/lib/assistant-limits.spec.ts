import {
  assistantLimits,
  conversationLimitProblem,
  MAX_CUSTOMER_MESSAGES,
  whatsappLink,
  whatsappNumber,
} from './assistant-limits'

describe('assistant limits', () => {
  it('reads positive integers from the environment and falls back to the defaults', () => {
    const env: Record<string, string> = {
      ASSISTANT_MAX_OUTPUT_TOKENS: '800',
      ASSISTANT_CONVERSATION_TOKEN_LIMIT: '-5',
      ASSISTANT_DAILY_TOKEN_LIMIT: 'abc',
    }
    expect(assistantLimits(key => env[key])).toEqual({
      maxOutputTokens: 800,
      conversationTokens: 400_000,
      dailyTokens: 5_000_000,
    })
  })

  it('closes a conversation that used its tokens or messages', () => {
    const limits = assistantLimits(() => undefined)
    expect(conversationLimitProblem({ tokens: 1_000, customerMessages: 3 }, limits)).toBeNull()
    expect(conversationLimitProblem({ tokens: 400_000, customerMessages: 3 }, limits)).toMatch(/límite/)
    expect(conversationLimitProblem({ tokens: 0, customerMessages: MAX_CUSTOMER_MESSAGES }, limits)).toMatch(/nueva/)
  })

  it('accepts WhatsApp numbers in international format only', () => {
    expect(whatsappNumber('+54 9 341 555-0000')).toBe('5493415550000')
    expect(whatsappNumber('341-555')).toBeNull()
    expect(whatsappNumber('')).toBeNull()
    expect(whatsappNumber(undefined)).toBeNull()
  })

  it('links to WhatsApp with the message already written', () => {
    expect(whatsappLink('5493415550000', 'Hola, quiero 10 L3250 & tinta')).toBe(
      'https://wa.me/5493415550000?text=Hola%2C%20quiero%2010%20L3250%20%26%20tinta',
    )
  })
})
