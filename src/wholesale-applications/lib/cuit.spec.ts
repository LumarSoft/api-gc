import { isValidCuit, normalizeCuit } from './cuit'

describe('cuit', () => {
  it('normalizes dashes and spaces', () => {
    expect(normalizeCuit('30-71234567-1')).toBe('30712345671')
    expect(normalizeCuit(' 20 12345678 6 ')).toBe('20123456786')
  })

  it('accepts valid check digits', () => {
    expect(isValidCuit('20123456786')).toBe(true)
    expect(isValidCuit('30500010912')).toBe(true)
    expect(isValidCuit('27000000006')).toBe(true)
  })

  it('rejects a wrong check digit, unknown prefix or bad length', () => {
    expect(isValidCuit('20123456787')).toBe(false)
    expect(isValidCuit('99123456786')).toBe(false)
    expect(isValidCuit('2012345678')).toBe(false)
    expect(isValidCuit('20-12345678-6')).toBe(false)
  })
})
