import { INestApplication, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import type { AdminBehaviorDto } from '../src/analytics/dto/behavior-response.dto'
import { AppModule } from '../src/app.module'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { ActivityType, CartStatus, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
const DAY_MS = 24 * 60 * 60 * 1000

describe('Store activity and behavior stats (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let adminCookie: string
  let suffix: string
  let categoryId: number
  let productId: number
  let variantId: number
  const userIds: number[] = []

  const send = (body: object, userAgent = BROWSER) =>
    request(app.getHttpServer()).post('/activity').set('User-Agent', userAgent).send(body)

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
    categoryId = (await prisma.category.create({ data: { name: 'Activity test', slug: `activity-${suffix}` } })).id
    productId = (
      await prisma.product.create({ data: { name: `Activity ${suffix}`, slug: `activity-${suffix}`, categoryId } })
    ).id
    variantId = (
      await prisma.productVariant.create({ data: { productId, sku: `ACTIVITY-${suffix}`, isDefault: true } })
    ).id
    const admin = await prisma.user.create({
      data: {
        email: `activity-admin-${suffix}@example.test`,
        firstName: 'Activity',
        lastName: 'Test',
        role: UserRole.ADMIN,
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    userIds.push(admin.id)
    adminCookie = `cg_at=${await app.get(JwtService).signAsync({ sub: admin.id })}`
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      await prisma.cart.updateMany({ where: { items: { some: { variantId } } }, data: { deletedAt: now } })
      await prisma.productVariant.updateMany({ where: { productId }, data: { deletedAt: now } })
      await prisma.product.updateMany({ where: { id: productId }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('records anonymous events and normalizes searches', async () => {
    const visitorId = randomUUID()
    await send({ type: 'VISIT', visitorId }).expect(204)
    await send({ type: 'PRODUCT_VIEW', visitorId, productId }).expect(204)
    await send({ type: 'SEARCH', visitorId, query: `  Tinta  ${suffix.toUpperCase()} `, resultCount: 0 }).expect(204)
    const events = await prisma.activityEvent.findMany({ where: { visitorId }, orderBy: { id: 'asc' } })
    expect(events.map(event => event.type)).toEqual([
      ActivityType.VISIT,
      ActivityType.PRODUCT_VIEW,
      ActivityType.SEARCH,
    ])
    expect(events[1].productId).toBe(productId)
    expect(events[2]).toMatchObject({ searchQuery: `tinta ${suffix}`, resultCount: 0, productId: null })
  })

  it('ignores bots and rejects incomplete or unknown events', async () => {
    const visitorId = randomUUID()
    await send({ type: 'VISIT', visitorId }, 'Mozilla/5.0 (compatible; Googlebot/2.1)').expect(204)
    expect(await prisma.activityEvent.count({ where: { visitorId } })).toBe(0)
    await send({ type: 'PRODUCT_VIEW', visitorId }).expect(400)
    await send({ type: 'SEARCH', visitorId, resultCount: 1 }).expect(400)
    await send({ type: 'VISIT', visitorId: 'not-a-uuid' }).expect(400)
    await send({ type: 'LOGIN', visitorId }).expect(400)
    await send({ type: 'ADD_TO_CART', visitorId, productId: 999_999_999 }).expect(404)
  })

  it('reports the funnel, viewed products, searches and abandoned carts of a period', async () => {
    // A day of the past only this run is likely to use, so the deltas are this run's own events.
    const day = new Date(Date.UTC(2021, 0, 1) + (parseInt(suffix.slice(0, 6), 16) % 1400) * DAY_MS)
    const at = new Date(day.getTime() + 15 * 60 * 60 * 1000)
    const iso = day.toISOString().slice(0, 10)
    const report = async (): Promise<AdminBehaviorDto> =>
      (
        await request(app.getHttpServer())
          .get(`/admin/analytics/behavior?from=${iso}&to=${iso}`)
          .set('Cookie', adminCookie)
          .expect(200)
      ).body as AdminBehaviorDto
    const before = await report()

    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()]
    const event = (type: ActivityType, visitorId: string, extra: object = {}) => ({
      type,
      visitorId,
      createdAt: at,
      ...extra,
    })
    await prisma.activityEvent.createMany({
      data: [
        event(ActivityType.VISIT, a),
        event(ActivityType.VISIT, b),
        event(ActivityType.VISIT, c),
        event(ActivityType.PRODUCT_VIEW, a, { productId }),
        event(ActivityType.PRODUCT_VIEW, a, { productId }),
        event(ActivityType.PRODUCT_VIEW, b, { productId }),
        event(ActivityType.ADD_TO_CART, a, { productId }),
        event(ActivityType.CHECKOUT_STARTED, a),
        event(ActivityType.SEARCH, b, { searchQuery: `nada ${suffix}`, resultCount: 0 }),
        event(ActivityType.SEARCH, c, { searchQuery: `nada ${suffix}`, resultCount: 0 }),
      ],
    })
    await prisma.cart.create({
      data: {
        status: CartStatus.ACTIVE,
        lastActivityAt: at,
        items: { create: { variantId, quantity: 2 } },
      },
    })
    const after = await report()

    expect(after.funnel.current.visited - before.funnel.current.visited).toBe(3)
    expect(after.funnel.current.viewedProduct - before.funnel.current.viewedProduct).toBe(2)
    expect(after.funnel.current.addedToCart - before.funnel.current.addedToCart).toBe(1)
    expect(after.funnel.current.startedCheckout - before.funnel.current.startedCheckout).toBe(1)
    expect(after.visitors.series.current).toHaveLength(1)
    expect(after.visitors.series.current[0] - before.visitors.series.current[0]).toBe(3)
    expect(after.products.find(row => row.id === productId)).toMatchObject({ viewers: 2, addedToCart: 1, unitsSold: 0 })
    expect(after.searches.total.current - before.searches.total.current).toBe(2)
    expect(after.searches.withoutResults.current - before.searches.withoutResults.current).toBe(2)
    expect(after.searches.unanswered.find(row => row.query === `nada ${suffix}`)).toMatchObject({
      searches: 2,
      visitors: 2,
      results: 0,
    })
    expect(after.carts.abandoned.current - before.carts.abandoned.current).toBe(1)
    expect(after.carts.products.find(row => row.id === productId)).toMatchObject({ carts: 1, units: 2 })
    expect(after.trackingSince).not.toBeNull()
  })

  it('is admin only', async () => {
    await request(app.getHttpServer()).get('/admin/analytics/behavior').expect(401)
  })
})
