/**
 * Plan for saving a whole ordered list (gallery, technical sheet) sent by the client: rows the client kept carry their
 * id, new rows have none. Returns the existing ids to remove and any id the client sent that is not one of the rows.
 */
export function planListSync(
  existingIds: number[],
  items: { id?: number }[],
): { removedIds: number[]; unknownIds: number[] } {
  const kept = new Set(items.flatMap(item => (item.id === undefined ? [] : [item.id])))
  const existing = new Set(existingIds)
  return {
    removedIds: existingIds.filter(id => !kept.has(id)),
    unknownIds: [...kept].filter(id => !existing.has(id)),
  }
}

/** True when an id appears twice in the list (the same row cannot be in two positions). */
export function hasRepeatedIds(items: { id?: number }[]): boolean {
  const ids = items.flatMap(item => (item.id === undefined ? [] : [item.id]))
  return new Set(ids).size !== ids.length
}
