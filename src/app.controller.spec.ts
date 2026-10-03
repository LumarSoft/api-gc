import { Test, TestingModule } from '@nestjs/testing'
import { ServiceUnavailableException } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaService } from './prisma/prisma.service'

describe('AppController', () => {
  let appController: AppController
  const prisma = { $queryRaw: jest.fn() }

  beforeEach(async () => {
    prisma.$queryRaw.mockReset()

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile()

    appController = app.get<AppController>(AppController)
  })

  describe('health', () => {
    it('returns ok when the database responds', async () => {
      prisma.$queryRaw.mockResolvedValue([{ 1: 1 }])
      await expect(appController.getHealth()).resolves.toEqual({ status: 'ok', database: 'up' })
    })

    it('throws 503 when the database is unreachable', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
      await expect(appController.getHealth()).rejects.toBeInstanceOf(ServiceUnavailableException)
    })
  })
})
