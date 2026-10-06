/** Provisional manual-payment window; configurable in Setting, matching the existing transfer window. */
export function reservationHours(setting: { value: unknown; deletedAt: Date | null } | null): number {
  const value = setting && !setting.deletedAt ? setting.value : null
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 168 ? value : 24
}
