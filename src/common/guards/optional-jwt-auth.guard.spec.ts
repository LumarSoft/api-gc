import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { BuyerType, UserRole, WholesaleStatus } from '../../generated/prisma/enums'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthenticatedUser } from '../types/authenticated-user'
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard'

type FakeRequest = { cookies?: Record<string, string>; headers: Record<string, string>; user?: AuthenticatedUser }

function contextFor(request: FakeRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
}

describe('OptionalJwtAuthGuard', () => {
  const jwt = { verifyAsync: jest.fn() }
  const prisma = { user: { findFirst: jest.fn() } }
  const guard = new OptionalJwtAuthGuard(jwt as unknown as JwtService, prisma as unknown as PrismaService)

  beforeEach(() => jest.resetAllMocks())

  it('lets anonymous visitors through without a user', async () => {
    const request: FakeRequest = { headers: {} }
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user).toBeUndefined()
  })

  it('attaches the user when the session is valid', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 7 })
    prisma.user.findFirst.mockResolvedValue({
      id: 7,
      email: 'a@b.com',
      role: UserRole.CUSTOMER,
      companyId: 3,
      company: { wholesaleStatus: WholesaleStatus.APPROVED },
    })
    const request: FakeRequest = { headers: {}, cookies: { cg_at: 'valid' } }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user?.buyerType).toBe(BuyerType.WHOLESALE)
  })

  it('answers 401 for an expired session so the client refreshes instead of seeing anonymous prices', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'))
    await expect(guard.canActivate(contextFor({ headers: {}, cookies: { cg_at: 'expired' } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })
})
