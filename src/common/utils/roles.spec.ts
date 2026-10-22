import { UserRole } from '../../generated/prisma/enums'
import { hasRole } from './roles'

describe('hasRole', () => {
  it('lets developers do what admins do, and not the other way round', () => {
    expect(hasRole(UserRole.DEVELOPER, UserRole.ADMIN)).toBe(true)
    expect(hasRole(UserRole.DEVELOPER, UserRole.DEVELOPER)).toBe(true)
    expect(hasRole(UserRole.ADMIN, UserRole.DEVELOPER)).toBe(false)
    expect(hasRole(UserRole.CUSTOMER, UserRole.ADMIN)).toBe(false)
  })
})
