import { BuyerType, UserRole } from '../../generated/prisma/enums'

/** User attached to the request by JwtAuthGuard. Always loaded fresh from the database. */
export interface AuthenticatedUser {
  id: number
  email: string
  role: UserRole
  buyerType: BuyerType
  companyId: number | null
}

export interface RequestWithUser {
  user?: AuthenticatedUser
}
