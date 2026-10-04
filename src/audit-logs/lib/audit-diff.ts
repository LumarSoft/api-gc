import { Prisma } from '../../generated/prisma/client'

/** A JSON-safe value as stored in AuditLog.changes. */
export type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue }

export type AuditChanges = Record<string, { from: AuditValue; to: AuditValue }>

/** Turns Decimals, Dates and nested objects into plain JSON values so they can be compared and stored. */
export function toAuditValue(value: unknown): AuditValue {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(toAuditValue)
  if (typeof value === 'bigint') return value.toString()
  if (Prisma.Decimal.isDecimal(value)) return value.toString()
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toAuditValue(item)]))
  }
  // Functions and symbols never belong in an audit row.
  return null
}

/**
 * Lists the fields that changed between two versions of a record: `{ field: { from, to } }`.
 * Only the keys present in `after` are compared, so a partial update records exactly what it touched.
 */
export function diffForAudit(before: object | null, after: object): AuditChanges {
  const previous = (before ?? {}) as Record<string, unknown>
  const changes: AuditChanges = {}
  for (const [field, value] of Object.entries(after)) {
    if (value === undefined) continue
    const from = toAuditValue(previous[field])
    const to = toAuditValue(value)
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to }
  }
  return changes
}
