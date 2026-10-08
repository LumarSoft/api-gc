import { applicationSearchWhere } from './wholesale-application-search'

describe('applicationSearchWhere', () => {
  const cuitTerm = (q: string): unknown =>
    applicationSearchWhere(q).OR?.find(
      condition => 'company' in condition && condition.company && 'cuit' in condition.company,
    )

  it('compares a CUIT typed with dashes, dots or spaces against the stored digits', () => {
    expect(cuitTerm('30-71234567-8')).toEqual({ company: { cuit: { contains: '30712345678' } } })
    expect(cuitTerm('30 7123')).toEqual({ company: { cuit: { contains: '307123' } } })
  })

  it('keeps any other term as typed', () => {
    expect(cuitTerm('Imprenta')).toEqual({ company: { cuit: { contains: 'Imprenta' } } })
    expect(cuitTerm('-')).toEqual({ company: { cuit: { contains: '-' } } })
  })
})
