import { isSameSet } from './collections'

describe('isSameSet', () => {
  it('compares values regardless of order', () => {
    expect(isSameSet([3, 1, 2], [1, 2, 3])).toBe(true)
    expect(isSameSet([1, 2], [1, 2, 3])).toBe(false)
    expect(isSameSet([1, 1, 2], [1, 2, 3])).toBe(false)
    expect(isSameSet([], [])).toBe(true)
  })
})
