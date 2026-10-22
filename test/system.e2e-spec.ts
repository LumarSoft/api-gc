import { HttpAdapterHost } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type { SystemStatusDto } from '../src/system/dto/system-status.dto'

describe('Developers system page (local MySQL e2e)', () => {
  let app: NestExpressApplication
  let prisma: PrismaService
  const userIds: number[] = []
  const cookies: Partial<Record<UserRole, string>> = {}
  const server = (): App => app.getHttpServer()

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = fixture.createNestApplication<NestExpressApplication>()
    app.use(cookieParser())
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    // Bind 127.0.0.1 explicitly: supertest connects there (see orders.e2e-spec.ts).
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)
    for (const role of [UserRole.CUSTOMER, UserRole.ADMIN, UserRole.DEVELOPER]) {
      const user = await prisma.user.create({
        data: {
          email: `system-${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`,
          firstName: 'Ana',
          lastName: 'Prueba',
          role,
          passwordHash: await hash(randomBytes(16).toString('hex'), 10),
        },
      })
      userIds.push(user.id)
      cookies[role] = `cg_at=${await app.get(JwtService).signAsync({ sub: user.id })}`
    }
  })

  afterAll(async () => {
    if (prisma) await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: new Date() } })
    if (app) await app.close()
  })

  it('is only for developers', async () => {
    await request(server()).get('/admin/system').expect(401)
    await request(server()).get('/admin/system').set('Cookie', cookies.CUSTOMER!).expect(403)
    await request(server()).get('/admin/system').set('Cookie', cookies.ADMIN!).expect(403)
  })

  it('says how the API, its integrations, its tasks and the store are doing, without any secret', async () => {
    const response = await request(server()).get('/admin/system').set('Cookie', cookies.DEVELOPER!).expect(200)
    const status = response.body as SystemStatusDto
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(status.database.latencyMs).toEqual(expect.any(Number))
    expect(status.database.migrations).toEqual({ total: expect.any(Number) as number, pending: [] })
    expect(status.api).toMatchObject({ node: process.version, uptimeSeconds: expect.any(Number) as number })
    expect(Object.keys(status.integrations).sort()).toEqual(['email', 'mercadoPago', 'openai', 'zipnova'])
    expect(status.jobs.orderExpiry).toMatchObject({ failed: expect.any(Boolean) as boolean })
    expect(status.store).toMatchObject({ publishedWithoutImages: expect.any(Number) as number })
    // Whatever this machine has configured, no credential travels in the answer.
    const secrets = [
      'MERCADO_PAGO_ACCESS_TOKEN',
      'MERCADO_PAGO_WEBHOOK_SECRET',
      'ZIPNOVA_API_KEY',
      'ZIPNOVA_API_SECRET',
    ]
      .concat(['ZIPNOVA_WEBHOOK_SECRET', 'OPENAI_API_KEY', 'JWT_SECRET', 'DATABASE_URL'])
      .map(key => process.env[key]?.trim())
      .filter((value): value is string => Boolean(value && value.length >= 8))
    for (const secret of secrets) expect(response.text).not.toContain(secret)
  })
})
