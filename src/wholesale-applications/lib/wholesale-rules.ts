import { TaxCondition, WholesaleStatus } from '../../generated/prisma/enums'

/** Frequent-customer accounts are for businesses: a final consumer buys as retail. */
export const APPLICANT_TAX_CONDITIONS = [
  TaxCondition.RESPONSABLE_INSCRIPTO,
  TaxCondition.MONOTRIBUTISTA,
  TaxCondition.EXENTO,
] as const

/** Why a customer cannot send a new application, or null when they can (no company yet, or a rejected one). */
export function applyBlockReason(status: WholesaleStatus | null): string | null {
  switch (status) {
    case WholesaleStatus.PENDING:
      return 'Ya tenés una solicitud en revisión.'
    case WholesaleStatus.APPROVED:
      return 'Tu cuenta de cliente frecuente ya está aprobada.'
    case WholesaleStatus.PAUSED:
      return 'Tu cuenta de cliente frecuente está pausada. Consultá al local para reactivarla.'
    default:
      return null
  }
}

export type WholesaleDecision = 'approve' | 'reject' | 'pause' | 'resume'

/** Company status a decision moves to, given the current one; null when the decision is not allowed. */
export function decisionTarget(decision: WholesaleDecision, current: WholesaleStatus): WholesaleStatus | null {
  if (decision === 'approve' && current === WholesaleStatus.PENDING) return WholesaleStatus.APPROVED
  if (decision === 'reject' && current === WholesaleStatus.PENDING) return WholesaleStatus.REJECTED
  if (decision === 'pause' && current === WholesaleStatus.APPROVED) return WholesaleStatus.PAUSED
  if (decision === 'resume' && current === WholesaleStatus.PAUSED) return WholesaleStatus.APPROVED
  return null
}
