/** The admin behind a change, recorded in every AuditLog row. */
export interface AuditActor {
  userId: number
  ipAddress: string | null
}
