import type { SystemLogLevel } from '../../generated/prisma/enums'

interface PageDto<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface SystemLogDto {
  id: number
  level: SystemLogLevel
  source: string
  route: string | null
  message: string
  stack: string | null
  /** Times it happened within a few seconds (stored once). */
  count: number
  createdAt: string
  lastSeenAt: string
}

export interface SystemLogsPageDto extends PageDto<SystemLogDto> {
  /** Every source of the last 30 days and how many times it logged, for the filter. */
  sources: { source: string; count: number }[]
}

export interface SystemActivityDto {
  id: number
  /** `<entity>.<verb>`, e.g. "product.update". */
  action: string
  entityType: string
  entityId: number | null
  /** `{ field: { from, to } }` as recorded; null when the action has no field changes (an upload, an archive). */
  changes: unknown
  ipAddress: string | null
  createdAt: string
  /** Null when the account was deleted. */
  user: { id: number; name: string; email: string } | null
}

export interface SystemActivityPageDto extends PageDto<SystemActivityDto> {
  /** Staff who changed something, for the filter. */
  users: { id: number; name: string }[]
  entityTypes: string[]
}
