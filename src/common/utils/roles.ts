import { UserRole } from '../../generated/prisma/enums'

/** Roles that also pass the checks of other roles: developers can do everything admins can. */
const INCLUDED_ROLES: Partial<Record<UserRole, UserRole[]>> = {
  [UserRole.DEVELOPER]: [UserRole.ADMIN],
}

/** Whether a user with role `actual` passes a check that asks for `required`. */
export function hasRole(actual: UserRole, required: UserRole): boolean {
  return actual === required || (INCLUDED_ROLES[actual]?.includes(required) ?? false)
}
