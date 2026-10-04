import { Prisma } from '../../generated/prisma/client'
import { diffForAudit, toAuditValue } from './audit-diff'

describe('audit diff', () => {
  it('serializes decimals, dates and nested values to plain JSON', () => {
    expect(toAuditValue(new Prisma.Decimal('1234.50'))).toBe('1234.5')
    expect(toAuditValue(new Date('2026-10-04T12:00:00Z'))).toBe('2026-10-04T12:00:00.000Z')
    expect(toAuditValue({ Color: 'Cyan', sizes: [1, undefined] })).toEqual({ Color: 'Cyan', sizes: [1, null] })
    expect(toAuditValue(undefined)).toBeNull()
  })

  it('records only the fields that changed in the update', () => {
    const before = { name: 'L3250', status: 'DRAFT', price: new Prisma.Decimal('100.00'), brandId: 1 }
    expect(diffForAudit(before, { name: 'L3250', status: 'PUBLISHED', price: new Prisma.Decimal('100') })).toEqual({
      status: { from: 'DRAFT', to: 'PUBLISHED' },
    })
  })

  it('treats a missing previous record as a creation and skips undefined fields', () => {
    expect(diffForAudit(null, { name: 'Nuevo', description: undefined })).toEqual({
      name: { from: null, to: 'Nuevo' },
    })
  })
})
