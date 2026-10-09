import { dispatchMode } from './dispatch-mode'

describe('dispatch mode', () => {
  it("tells staff how Zipnova's dispatch codes hand the parcel over", () => {
    expect(dispatchMode('carrier_dropoff')).toBe('CARRIER_BRANCH')
    expect(dispatchMode('xd_dropoff')).toBe('PROVIDER_HUB')
    expect(dispatchMode('crossdock')).toBe('PICKUP')
    expect(dispatchMode('self_service')).toBeNull()
    expect(dispatchMode(null)).toBeNull()
  })
})
