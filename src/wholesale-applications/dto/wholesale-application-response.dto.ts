import { TaxCondition, WholesaleStatus } from '../../generated/prisma/enums'

export class WholesaleCompanyDto {
  id: number
  legalName: string
  tradeName: string | null
  cuit: string
  taxCondition: TaxCondition
  email: string
  phone: string | null
  wholesaleStatus: WholesaleStatus
}

export class WholesaleApplicationDto {
  id: number
  status: WholesaleStatus
  message: string | null
  /** Reason given by the team to the customer (rejection or pause). */
  reviewNote: string | null
  createdAt: string
  reviewedAt: string | null
  company: WholesaleCompanyDto
}

/** GET /wholesale-applications/mine: what the signed-in customer needs to see their status or apply. */
export class MyWholesaleApplicationDto {
  /** Latest application, null when the customer never applied. */
  application: WholesaleApplicationDto | null
  canApply: boolean
  /** Why `canApply` is false, in Spanish, ready to show. */
  blockReason: string | null
}

export class AdminWholesaleApplicationDto extends WholesaleApplicationDto {
  submittedBy: { id: number; name: string; email: string }
  reviewedBy: { id: number; name: string } | null
  /** False when the company sent a newer application; only the latest accepts decisions. */
  latest: boolean
  /** Decisions allowed now: approve/reject for a pending company, pause/resume for an approved/paused one. */
  allowedDecisions: ('approve' | 'reject' | 'pause' | 'resume')[]
}

export class WholesaleApplicationsPageDto {
  items: AdminWholesaleApplicationDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
