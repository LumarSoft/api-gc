import { ConflictException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import { hashToken } from '../common/utils/secure-token'
import { AuthTokenType, BuyerType, UserRole, WholesaleStatus } from '../generated/prisma/enums'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService } from './auth.service'
import { RefreshRaceException } from './refresh-race.exception'

const profileRow = {
  id: 1,
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: 'Pérez',
  phone: null,
  role: UserRole.CUSTOMER,
  emailVerifiedAt: null,
  company: null,
}

function createPrismaMock() {
  return {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    authToken: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
  }
}

describe('AuthService', () => {
  let service: AuthService
  let prisma: ReturnType<typeof createPrismaMock>
  const mail = { send: jest.fn() }

  beforeEach(async () => {
    prisma = createPrismaMock()
    mail.send.mockReset()

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        { provide: JwtService, useValue: { signAsync: jest.fn().mockResolvedValue('access-token') } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile()

    service = moduleRef.get(AuthService)
  })

  describe('register', () => {
    it('rejects an email that is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 9 })
      await expect(
        service.register({ email: 'ana@example.com', password: 'secreta123', firstName: 'Ana', lastName: 'Pérez' }),
      ).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.user.create).not.toHaveBeenCalled()
    })

    it('stores a bcrypt hash, never the plain password, and sends the verification email', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.user.create.mockResolvedValue({ id: 1, email: 'ana@example.com', firstName: 'Ana' })
      prisma.user.findFirst.mockResolvedValue(profileRow)

      const result = await service.register({
        email: 'ana@example.com',
        password: 'secreta123',
        firstName: 'Ana',
        lastName: 'Pérez',
      })

      const [createArgs] = prisma.user.create.mock.calls[0] as [{ data: { passwordHash: string } }]
      expect(createArgs.data.passwordHash).not.toBe('secreta123')
      expect(createArgs.data.passwordHash.startsWith('$2')).toBe(true)
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ template: 'email-verification' }))
      expect(result.user.buyerType).toBe(BuyerType.RETAIL)
      expect(result.tokens.accessToken).toBe('access-token')
    })
  })

  describe('login', () => {
    it('rejects a wrong password with the same error as an unknown email', async () => {
      prisma.user.findFirst.mockResolvedValueOnce({ id: 1, passwordHash: await hash('otra-clave1', 4) })
      await expect(service.login({ email: 'ana@example.com', password: 'secreta123' })).rejects.toThrow(
        'Invalid email or password',
      )

      prisma.user.findFirst.mockResolvedValueOnce(null)
      await expect(service.login({ email: 'nadie@example.com', password: 'secreta123' })).rejects.toThrow(
        'Invalid email or password',
      )
    })

    it('derives WHOLESALE only for users of an approved company', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce({ id: 1, passwordHash: await hash('secreta123', 4) })
        .mockResolvedValueOnce({
          ...profileRow,
          company: { id: 3, legalName: 'Imprenta SA', wholesaleStatus: WholesaleStatus.APPROVED },
        })

      const result = await service.login({ email: 'ana@example.com', password: 'secreta123' })
      expect(result.user.buyerType).toBe(BuyerType.WHOLESALE)
    })
  })

  describe('refresh', () => {
    it('revokes every session when an already-used refresh token is presented', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 5,
        userId: 1,
        type: AuthTokenType.REFRESH,
        usedAt: new Date(Date.now() - 5 * 60_000),
        expiresAt: new Date(Date.now() + 60_000),
        deletedAt: null,
      })

      await expect(service.refresh('stolen-token')).rejects.toBeInstanceOf(UnauthorizedException)
      const [revokeArgs] = prisma.authToken.updateMany.mock.calls[0] as [{ where: { userId: number; type: string } }]
      expect(revokeArgs.where).toMatchObject({ userId: 1, type: AuthTokenType.REFRESH })
    })

    it('treats a reuse within seconds as a two-tab race and keeps the other sessions', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 5,
        userId: 1,
        type: AuthTokenType.REFRESH,
        usedAt: new Date(Date.now() - 2_000),
        expiresAt: new Date(Date.now() + 60_000),
        deletedAt: null,
      })

      await expect(service.refresh('just-rotated')).rejects.toBeInstanceOf(RefreshRaceException)
      expect(prisma.authToken.updateMany).not.toHaveBeenCalled()
    })

    it('looks the token up by its hash', async () => {
      prisma.authToken.findUnique.mockResolvedValue(null)
      await expect(service.refresh('raw-token')).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.authToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashToken('raw-token') } }),
      )
    })
  })

  describe('forgotPassword', () => {
    it('does nothing (and reveals nothing) for an unknown email', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      await expect(service.forgotPassword({ email: 'nadie@example.com' })).resolves.toBeUndefined()
      expect(mail.send).not.toHaveBeenCalled()
    })
  })

  describe('verifyEmail', () => {
    it('rejects a link that another request used a moment earlier', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 8,
        userId: 1,
        type: AuthTokenType.EMAIL_VERIFICATION,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        deletedAt: null,
      })
      prisma.authToken.updateMany.mockResolvedValue({ count: 0 })

      await expect(service.verifyEmail('double-click')).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('resetPassword', () => {
    it('rejects an expired link', async () => {
      prisma.authToken.findUnique.mockResolvedValue({
        id: 7,
        userId: 1,
        type: AuthTokenType.PASSWORD_RESET,
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        deletedAt: null,
      })
      await expect(service.resetPassword({ token: 'x', password: 'nueva1234' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      )
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })
})
