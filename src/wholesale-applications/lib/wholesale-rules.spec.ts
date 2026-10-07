import { WholesaleStatus } from '../../generated/prisma/enums'
import { applyBlockReason, decisionTarget } from './wholesale-rules'

describe('wholesale rules', () => {
  it('lets customers apply without a company or after a rejection only', () => {
    expect(applyBlockReason(null)).toBeNull()
    expect(applyBlockReason(WholesaleStatus.REJECTED)).toBeNull()
    expect(applyBlockReason(WholesaleStatus.PENDING)).toMatch(/revisión/)
    expect(applyBlockReason(WholesaleStatus.APPROVED)).toMatch(/aprobada/)
    expect(applyBlockReason(WholesaleStatus.PAUSED)).toMatch(/pausada/)
  })

  it('allows only the decisions that make sense for the current status', () => {
    expect(decisionTarget('approve', WholesaleStatus.PENDING)).toBe(WholesaleStatus.APPROVED)
    expect(decisionTarget('reject', WholesaleStatus.PENDING)).toBe(WholesaleStatus.REJECTED)
    expect(decisionTarget('pause', WholesaleStatus.APPROVED)).toBe(WholesaleStatus.PAUSED)
    expect(decisionTarget('resume', WholesaleStatus.PAUSED)).toBe(WholesaleStatus.APPROVED)
    expect(decisionTarget('approve', WholesaleStatus.REJECTED)).toBeNull()
    expect(decisionTarget('pause', WholesaleStatus.PENDING)).toBeNull()
    expect(decisionTarget('resume', WholesaleStatus.APPROVED)).toBeNull()
  })
})
