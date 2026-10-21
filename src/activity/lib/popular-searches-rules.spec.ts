import { isShareableSearch } from './popular-searches-rules'

describe('popular searches rules', () => {
  it('suggests product searches and leaves out what looks like personal data', () => {
    expect(isShareableSearch('ecotank')).toBe(true)
    expect(isShareableSearch('tinta l3250')).toBe(true)
    expect(isShareableSearch('ana@example.com')).toBe(false)
    expect(isShareableSearch('3415550000')).toBe(false)
    expect(isShareableSearch('dni 30123456')).toBe(false)
    expect(isShareableSearch('a')).toBe(false)
    expect(isShareableSearch('busco una impresora que imprima fotos para mi negocio')).toBe(false)
  })
})
