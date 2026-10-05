import { adjustmentDelta, onHandError } from './stock-rules'

describe('stock rules', () => {
  it('never lets on hand go below what open orders reserved', () => {
    expect(onHandError(10, 2)).toBeNull()
    expect(onHandError(2, 2)).toBeNull()
    expect(onHandError(1, 2)).toMatch(/2 units reserved/)
  })

  it('records the signed difference as the movement', () => {
    expect(adjustmentDelta(5, 12)).toBe(7)
    expect(adjustmentDelta(12, 5)).toBe(-7)
    expect(adjustmentDelta(0, 0)).toBe(0)
  })
})
