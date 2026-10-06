import { Injectable } from '@nestjs/common'
import type { AdminWholesaleApplicationDto, WholesaleApplicationDto } from './dto/wholesale-application-response.dto'
import type { ApplicationRow } from './lib/wholesale-application-selects'
import { decisionTarget, type WholesaleDecision } from './lib/wholesale-rules'

const DECISIONS: WholesaleDecision[] = ['approve', 'reject', 'pause', 'resume']

@Injectable()
export class WholesaleApplicationMapper {
  customer(row: ApplicationRow): WholesaleApplicationDto {
    return {
      id: row.id,
      status: row.status,
      message: row.message,
      reviewNote: row.reviewNote,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      company: row.company,
    }
  }

  /** `latest` = this is the company's most recent application; decisions only apply to it. */
  admin(row: ApplicationRow, latest: boolean): AdminWholesaleApplicationDto {
    return {
      ...this.customer(row),
      submittedBy: {
        id: row.submittedBy.id,
        name: `${row.submittedBy.firstName} ${row.submittedBy.lastName}`.trim(),
        email: row.submittedBy.email,
      },
      reviewedBy: row.reviewedBy
        ? { id: row.reviewedBy.id, name: `${row.reviewedBy.firstName} ${row.reviewedBy.lastName}`.trim() }
        : null,
      latest,
      allowedDecisions: latest
        ? DECISIONS.filter(decision => decisionTarget(decision, row.company.wholesaleStatus) !== null)
        : [],
    }
  }
}
