import { INestApplication, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from '../src/app.module'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { DeliveryMethod, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type { AdminSettingsDto } from '../src/settings/dto/settings-response.dto'
import { RESERVATION_HOURS_KEY } from '../src/settings/lib/settings-rules'

describe('Admin settings (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let adminCookie: string
  let customerCookie: string
  let suffix: string
  const userIds: number[] = []
  // These settings are global to the test database: remember them and put them back afterwards.
  let savedMethod: Awaited<ReturnType<PrismaService['shippingMethod']['findUnique']>>
  let savedSetting: Awaited<ReturnType<PrismaService['setting']['findUnique']>>
  const put = (path: string, body: object, cookie = adminCookie): request.Test =>
    request(app.getHttpServer()).put(`/admin/settings/${path}`).set('Cookie', cookie).send(body)

  async function user(role: UserRole): Promise<string> {
    const created = await prisma.user.create({
      data: {
        email: `settings-${role.toLowerCase()}-${suffix}@example.test`,
        firstName: 'Settings',
        lastName: 'Test',
        role,
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    userIds.push(created.id)
    return `cg_at=${await app.get(JwtService).signAsync({ sub: created.id })}`
  }

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = fixture.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    // Bind 127.0.0.1 explicitly: supertest connects there (see orders.e2e-spec.ts).
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)
    suffix = randomUUID().slice(0, 8)
    savedMethod = await prisma.shippingMethod.findUnique({ where: { code: DeliveryMethod.LOCAL_DELIVERY } })
    savedSetting = await prisma.setting.findUnique({ where: { key: RESERVATION_HOURS_KEY } })
    adminCookie = await user(UserRole.ADMIN)
    customerCookie = await user(UserRole.CUSTOMER)
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      if (savedMethod) {
        const { id, ...fields } = savedMethod
        await prisma.shippingMethod.update({ where: { id }, data: fields })
      } else {
        await prisma.shippingMethod.updateMany({
          where: { code: DeliveryMethod.LOCAL_DELIVERY },
          data: { deletedAt: now },
        })
      }
      if (savedSetting) {
        const { id, value, ...fields } = savedSetting
        await prisma.setting.update({ where: { id }, data: { ...fields, value: value ?? 24 } })
      } else {
        await prisma.setting.updateMany({ where: { key: RESERVATION_HOURS_KEY }, data: { deletedAt: now } })
      }
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('is admin only and validates amounts and hours', async () => {
    await request(app.getHttpServer()).get('/admin/settings').expect(401)
    await request(app.getHttpServer()).get('/admin/settings').set('Cookie', customerCookie).expect(403)
    await put('local-delivery', { isActive: true, flatRate: '-5' }).expect(400)
    await put('local-delivery', { isActive: true, flatRate: '12.345' }).expect(400)
    await put('local-delivery', { isActive: true }).expect(422)
    await put('local-delivery', { isActive: true, flatRate: '3500', freeShippingThreshold: '0' }).expect(422)
    await put('reservation', { manualHours: 0 }).expect(400)
    await put('reservation', { manualHours: 169 }).expect(400)
    await put('reservation', { manualHours: 48 }, customerCookie).expect(403)
  })

  it('turns Rosario delivery on with a rate and threshold in the row checkout reads', async () => {
    const saved = (
      await put('local-delivery', { isActive: true, flatRate: '3500', freeShippingThreshold: '80000.50' }).expect(200)
    ).body as AdminSettingsDto
    expect(saved.localDelivery).toEqual({
      isActive: true,
      flatRate: { amount: '3500.00', currency: 'ARS' },
      freeShippingThreshold: { amount: '80000.50', currency: 'ARS' },
    })
    // The row checkout reads (checkoutDeliveryOptions turns it into an enabled option, covered by its unit tests).
    const row = await prisma.shippingMethod.findFirstOrThrow({
      where: { code: DeliveryMethod.LOCAL_DELIVERY, deletedAt: null },
    })
    expect([row.isActive, row.currency, row.flatRate?.toFixed(2), row.freeShippingThreshold?.toFixed(2)]).toEqual([
      true,
      'ARS',
      '3500.00',
      '80000.50',
    ])
    expect(await prisma.auditLog.count({ where: { action: 'settings.local-delivery', userId: userIds[0] } })).toBe(1)

    const off = (
      await put('local-delivery', { isActive: false, flatRate: '3500', freeShippingThreshold: null }).expect(200)
    ).body as AdminSettingsDto
    expect(off.localDelivery.isActive).toBe(false)
    expect(off.localDelivery.freeShippingThreshold).toBeNull()
  })

  it('stores the reservation window that checkout uses', async () => {
    const saved = (await put('reservation', { manualHours: 48 }).expect(200)).body as AdminSettingsDto
    expect(saved.reservation).toEqual({ manualHours: 48, isDefault: false })
    const read = (await request(app.getHttpServer()).get('/admin/settings').set('Cookie', adminCookie).expect(200))
      .body as AdminSettingsDto
    expect(read.reservation.manualHours).toBe(48)
    expect(await prisma.auditLog.count({ where: { action: 'settings.reservation', userId: userIds[0] } })).toBe(1)
  })
})
