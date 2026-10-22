import { BadRequestException, Controller, Get, Logger, Param, ValidationPipe } from '@nestjs/common'
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
import { AuditLogsService } from '../src/audit-logs/audit-logs.service'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { SystemLogLevel, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type { SystemActivityPageDto, SystemLogsPageDto } from '../src/system/dto/system-list-response.dto'
import type { SystemStatusDto } from '../src/system/dto/system-status.dto'
import { SystemLogPurgeService } from '../src/system/system-log-purge.service'
import { SystemLogRecorder } from '../src/system/system-log-recorder.service'
import { SystemLogger } from '../src/system/system-logger'

/** Only in this suite: a route that fails like a bug would, and one that answers a client error. */
@Controller('system-logs-test')
class FailingController {
  @Get('crash/:id')
  crash(@Param('id') id: string): never {
    throw new Error(`kaboom ${id}`)
  }

  @Get('bad/:id')
  bad(@Param('id') id: string): never {
    throw new BadRequestException(`bad ${id}`)
  }
}

describe('Developers system errors and activity (local MySQL e2e)', () => {
  let app: NestExpressApplication
  let prisma: PrismaService
  const userIds: number[] = []
  const cookies: Partial<Record<UserRole, string>> = {}
  let developerId: number
  /** Unique per run, so the searches only find this suite's entries. */
  const tag = `syslog${randomUUID().slice(0, 8)}`
  const server = (): App => app.getHttpServer()
  const asDeveloper = <T>(path: string): Promise<T> =>
    request(server())
      .get(path)
      .set('Cookie', cookies.DEVELOPER!)
      .expect(200)
      .then(response => response.body as T)

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule], controllers: [FailingController] }).compile()
    app = fixture.createNestApplication<NestExpressApplication>()
    // The API's logger, as main.ts sets it; only errors and warnings printed, to keep the test output readable.
    const logger = app.get(SystemLogger)
    logger.setLogLevels(['error', 'warn'])
    app.useLogger(logger)
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    // Bind 127.0.0.1 explicitly: supertest connects there (see orders.e2e-spec.ts).
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)
    for (const role of [UserRole.ADMIN, UserRole.DEVELOPER]) {
      const user = await prisma.user.create({
        data: {
          email: `${tag}-${role.toLowerCase()}@example.test`,
          firstName: 'Ana',
          lastName: role === UserRole.DEVELOPER ? 'Dev' : 'Admin',
          role,
          passwordHash: await hash(randomBytes(16).toString('hex'), 10),
        },
      })
      userIds.push(user.id)
      if (role === UserRole.DEVELOPER) developerId = user.id
      cookies[role] = `cg_at=${await app.get(JwtService).signAsync({ sub: user.id })}`
    }
  })

  afterAll(async () => {
    if (prisma) {
      // An operational log: this suite's entries are removed for real (see database.md).
      await prisma.systemLog.deleteMany({ where: { message: { contains: tag } } })
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: new Date() } })
    }
    if (app) await app.close()
  })

  it('is only for developers', async () => {
    for (const path of ['/admin/system/logs', '/admin/system/activity']) {
      await request(server()).get(path).expect(401)
      await request(server()).get(path).set('Cookie', cookies.ADMIN!).expect(403)
    }
  })

  it('keeps what the code logs as an error or a warning, with the class that logged it, repeats counted once', async () => {
    const logger = new Logger('SystemLogsSuite')
    for (let time = 0; time < 3; time++) logger.error(`provider down ${tag}`)
    logger.warn(`slow answer ${tag}`)
    logger.log(`all good ${tag}`)
    await app.get(SystemLogRecorder).flush()

    const page = await asDeveloper<SystemLogsPageDto>(`/admin/system/logs?q=${tag}`)
    expect(page.items.map(item => [item.level, item.source, item.message, item.count]).sort()).toEqual([
      [SystemLogLevel.ERROR, 'SystemLogsSuite', `provider down ${tag}`, 3],
      [SystemLogLevel.WARN, 'SystemLogsSuite', `slow answer ${tag}`, 1],
    ])
    expect(page.sources).toContainEqual({ source: 'SystemLogsSuite', count: expect.any(Number) as number })
    const errors = await asDeveloper<SystemLogsPageDto>(`/admin/system/logs?q=${tag}&level=ERROR`)
    expect(errors.items).toHaveLength(1)
  })

  it('keeps the requests that fail on our side with their route pattern, not the client errors', async () => {
    await request(server()).get(`/system-logs-test/crash/${tag}`).expect(500)
    await request(server()).get(`/system-logs-test/bad/${tag}`).expect(400)
    await app.get(SystemLogRecorder).flush()

    const page = await asDeveloper<SystemLogsPageDto>(`/admin/system/logs?source=HTTP&q=${tag}`)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      level: SystemLogLevel.ERROR,
      route: 'GET /system-logs-test/crash/:id',
      message: `kaboom ${tag}`,
    })
    expect(page.items[0].stack).toContain('FailingController')
    // Nest's own report of the same crash is not stored twice.
    const all = await asDeveloper<SystemLogsPageDto>(`/admin/system/logs?q=kaboom ${tag}`)
    expect(all.items).toHaveLength(1)
    const status = await asDeveloper<SystemStatusDto>('/admin/system')
    expect(status.logs.last24h.errors).toBeGreaterThanOrEqual(1)
  })

  it('forgets entries after 30 days', async () => {
    const old = await prisma.systemLog.create({
      data: {
        level: SystemLogLevel.ERROR,
        source: 'SystemLogsSuite',
        message: `old ${tag}`,
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      },
    })
    await app.get(SystemLogPurgeService).purge()
    expect(await prisma.systemLog.count({ where: { id: old.id } })).toBe(0)
    expect(await prisma.systemLog.count({ where: { message: `provider down ${tag}` } })).toBe(1)
  })

  it('lists what staff changed in the admin, with who did it, filtered by person and type', async () => {
    const actor = { userId: developerId, ipAddress: '10.0.0.1' }
    const audit = app.get(AuditLogsService)
    await audit.record(actor, {
      action: 'product.update',
      entityType: 'Product',
      entityId: 1,
      changes: { name: { from: 'A', to: tag } },
    })
    await audit.record(actor, { action: 'settings.reservation', entityType: 'Setting', entityId: null })

    const page = await asDeveloper<SystemActivityPageDto>(`/admin/system/activity?userId=${developerId}`)
    expect(page.items.map(item => item.action)).toEqual(['settings.reservation', 'product.update'])
    expect(page.items[1]).toMatchObject({
      entityType: 'Product',
      changes: { name: { from: 'A', to: tag } },
      ipAddress: '10.0.0.1',
      user: { id: developerId, name: 'Ana Dev' },
    })
    expect(page.users).toContainEqual({ id: developerId, name: 'Ana Dev' })
    expect(page.entityTypes).toEqual(expect.arrayContaining(['Product', 'Setting']))
    const products = await asDeveloper<SystemActivityPageDto>(
      `/admin/system/activity?userId=${developerId}&entityType=Product`,
    )
    expect(products.items.map(item => item.action)).toEqual(['product.update'])
  })
})
