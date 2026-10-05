/** Why a new on-hand quantity is not allowed, or null. Reserved units belong to orders being paid. */
export function onHandError(onHand: number, reserved: number): string | null {
  if (onHand < reserved) return `On hand cannot be below the ${reserved} units reserved by open orders`
  return null
}

/** Signed change recorded in the stock ledger: positive adds units, negative removes them. */
export function adjustmentDelta(currentOnHand: number, newOnHand: number): number {
  return newOnHand - currentOnHand
}
