import { excerpt, monthStart, searchedId, sumUsage, usageDays } from './admin-assistant-rules'

describe('admin assistant rules', () => {
  it('puts the first question on one line and cuts it with an ellipsis', () => {
    expect(excerpt('  ¿Tienen la L3250?\n\n¿Y en cuotas?  ')).toBe('¿Tienen la L3250? ¿Y en cuotas?')
    expect(excerpt('a'.repeat(250))).toHaveLength(200)
    expect(excerpt('a'.repeat(250)).endsWith('…')).toBe(true)
    expect(excerpt('palabra '.repeat(30), 20)).toBe('palabra palabra pal…')
    expect(excerpt(`${'a'.repeat(18)}🖨️🖨️`, 20)).toBe(`${'a'.repeat(18)}🖨…`)
  })

  it('reads a conversation id typed with or without #', () => {
    expect(searchedId('#12')).toBe(12)
    expect(searchedId('12')).toBe(12)
    expect(searchedId('L3250')).toBeNull()
    expect(searchedId('# 12')).toBeNull()
    expect(searchedId('1234567890')).toBeNull()
  })

  it('finds the first day of the month', () => {
    expect(monthStart('2026-10-21')).toBe('2026-10-01')
    expect(monthStart('2026-02-01')).toBe('2026-02-01')
  })

  it('fills every day of the period and adds them up', () => {
    const days = usageDays(
      ['2026-10-19', '2026-10-20', '2026-10-21'],
      new Map([
        ['2026-10-19', { conversations: 2, customerMessages: 5, inputTokens: 1000, outputTokens: 100 }],
        ['2026-10-21', { customerMessages: 1, inputTokens: 300, outputTokens: 30 }],
      ]),
    )
    expect(days).toEqual([
      { day: '2026-10-19', conversations: 2, customerMessages: 5, inputTokens: 1000, outputTokens: 100 },
      { day: '2026-10-20', conversations: 0, customerMessages: 0, inputTokens: 0, outputTokens: 0 },
      { day: '2026-10-21', conversations: 0, customerMessages: 1, inputTokens: 300, outputTokens: 30 },
    ])
    expect(sumUsage(days)).toEqual({ conversations: 2, customerMessages: 6, inputTokens: 1300, outputTokens: 130 })
  })
})
