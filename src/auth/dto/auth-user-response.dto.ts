import { BuyerType, UserRole, WholesaleStatus } from '../../generated/prisma/enums'

export class AuthCompanyResponseDto {
  id: number
  legalName: string
  wholesaleStatus: WholesaleStatus
}

/** Public view of the logged-in user. Never includes the password hash or tokens. */
export class AuthUserResponseDto {
  id: number
  email: string
  firstName: string
  lastName: string
  phone: string | null
  role: UserRole
  /** Derived: WHOLESALE only when the company is APPROVED. */
  buyerType: BuyerType
  emailVerified: boolean
  company: AuthCompanyResponseDto | null
}
