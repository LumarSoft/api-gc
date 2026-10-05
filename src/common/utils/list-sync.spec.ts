import { hasRepeatedIds, planListSync } from './list-sync'

describe('planListSync', () => {
  it('removes rows the client left out and keeps the rest', () => {
    expect(planListSync([1, 2, 3], [{ id: 3 }, {}, { id: 1 }])).toEqual({ removedIds: [2], unknownIds: [] })
  })

  it('reports ids that do not belong to the list', () => {
    expect(planListSync([1], [{ id: 1 }, { id: 99 }])).toEqual({ removedIds: [], unknownIds: [99] })
  })

  it('detects the same row sent twice', () => {
    expect(hasRepeatedIds([{ id: 1 }, {}, { id: 1 }])).toBe(true)
    expect(hasRepeatedIds([{ id: 1 }, {}, {}])).toBe(false)
  })
})
