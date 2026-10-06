const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
/** AFIP prefixes: people (20, 23, 24, 27) and companies (30, 33, 34). */
const PREFIXES = new Set(['20', '23', '24', '27', '30', '33', '34'])

/** "30-71234567-8" or "30 71234567 8" → "30712345678". Anything else is left for `isValidCuit` to reject. */
export function normalizeCuit(value: string): string {
  return value.replace(/[\s-]/g, '')
}

/** 11 digits, a known prefix and the official check digit. */
export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit) || !PREFIXES.has(cuit.slice(0, 2))) return false
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(cuit[index]), 0)
  const remainder = 11 - (sum % 11)
  const checkDigit = remainder === 11 ? 0 : remainder
  return checkDigit !== 10 && checkDigit === Number(cuit[10])
}
