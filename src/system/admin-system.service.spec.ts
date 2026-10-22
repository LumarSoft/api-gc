import { expiryJobHealth } from './admin-system.service'

describe('expiryJobHealth', () => {
  it('reads how the last run of the reservation expiry went, and nothing else', () => {
    expect(expiryJobHealth({ failed: true, lastRunAt: '2026-10-22T03:00:00.000Z' })).toEqual({
      failed: true,
      lastRunAt: '2026-10-22T03:00:00.000Z',
    })
    expect(expiryJobHealth(null)).toEqual({ failed: false, lastRunAt: null })
    expect(expiryJobHealth({ failed: 'yes', lastRunAt: 5 })).toEqual({ failed: false, lastRunAt: null })
  })
})
