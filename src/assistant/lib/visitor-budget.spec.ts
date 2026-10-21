import { VISITOR_CONVERSATIONS_PER_HOUR, VisitorBudget, visitorKeys } from './visitor-budget'

describe('visitor budget', () => {
  const day = '2026-10-21'
  const hour = 3_600_000

  it('stops a visitor at a tenth of the store daily tokens, until the next day', () => {
    const budget = new VisitorBudget(1_000_000)
    const keys = visitorKeys('10.0.0.1', undefined)
    budget.spent(keys, 99_999, day, 0)
    expect(budget.allows(keys, false, day, 1)).toBe(true)
    budget.spent(keys, 1, day, 2)
    expect(budget.allows(keys, false, day, 3)).toBe(false)
    expect(budget.allows(visitorKeys('10.0.0.2', undefined), false, day, 3)).toBe(true)
    expect(budget.allows(keys, false, '2026-10-22', 4)).toBe(true)
  })

  it('limits new conversations per hour, not messages in an open one', () => {
    const budget = new VisitorBudget(1_000_000)
    const keys = visitorKeys('10.0.0.1', undefined)
    for (let index = 0; index < VISITOR_CONVERSATIONS_PER_HOUR; index++) budget.started(keys, day, index)
    expect(budget.allows(keys, true, day, 100)).toBe(false)
    expect(budget.allows(keys, false, day, 100)).toBe(true)
    expect(budget.allows(keys, true, day, hour + 100)).toBe(true)
  })

  it('stops a signed-in visitor by their account on any IP', () => {
    const budget = new VisitorBudget(1_000_000)
    budget.spent(visitorKeys('10.0.0.1', 7), 100_000, day, 0)
    expect(budget.allows(visitorKeys('10.0.0.9', 7), false, day, 1)).toBe(false)
    expect(budget.allows(visitorKeys('10.0.0.9', undefined), false, day, 1)).toBe(true)
  })
})
