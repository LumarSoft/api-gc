/** True when both lists hold exactly the same values, in any order (duplicates make it false). */
export function isSameSet<T>(a: T[], b: T[]): boolean {
  const set = new Set(a)
  return set.size === a.length && a.length === b.length && b.every(value => set.has(value))
}
