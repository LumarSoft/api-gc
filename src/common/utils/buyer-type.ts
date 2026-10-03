import { BuyerType, WholesaleStatus } from '../../generated/prisma/enums'

/** The buyer profile is derived, never stored: WHOLESALE only when the user's company is APPROVED. */
export function resolveBuyerType(companyStatus: WholesaleStatus | null | undefined): BuyerType {
  return companyStatus === WholesaleStatus.APPROVED ? BuyerType.WHOLESALE : BuyerType.RETAIL
}
