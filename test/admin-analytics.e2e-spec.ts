import { INestApplication, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { randomBytes, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import type { AdminAnalyticsDto } from '../src/analytics/dto/analytics-response.dto'
import { AppModule } from '../src/app.module'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { BuyerType, OrderStatus, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'

const DAY_MS = 24 * 60 * 60 * 1000

describe('Admin analytics (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let adminCookie: string
  let customerCookie: string
  let priceListId: number
  let suffix: string
  let email: string
  let categoryIds: number[] = []
  let productId: number
  let variantId: number
  const userIds: number[] = []
  const report = async (query = ''): Promise<AdminAnalyticsDto> =>
    (await request(app.getHttpServer()).get(`/admin/analytics${query}`).set('Cookie', adminCookie).expect(200))
      .body as AdminAnalyticsDto

  async function user(role: UserRole): Promise<string> {
    const created = await prisma.user.create({
      data: {
        email: `analytics-${role.toLowerCase()}-${suffix}@example.test`,
        firstName: 'Analytics',
        lastName: 'Test',
        role,
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    userIds.push(created.id)
    return `cg_at=${await app.get(JwtService).signAsync({ sub: created.id })}`
  }

  /** An order of `units` units of the test variant at 300,000,000 ARS each, so it tops the rankings. */
  function order(status: OrderStatus, placedAt: Date, confirmedAt: Date | null, units = 1) {
    const lineTotal = (300_000_000 * units).toFixed(2)
    return prisma.order.create({
      data: {
        number: `CG-8${randomBytes(4).readUInt32BE() % 1_000_000_000}`.slice(0, 13),
        buyerType: BuyerType.WHOLESALE,
        priceListId,
        status,
        paymentMethod: 'MANUAL',
        deliveryMethod: 'STORE_PICKUP',
        subtotal: lineTotal,
        total: lineTotal,
        contactEmail: email,
        placedAt,
        confirmedAt,
        items: {
          create: {
            variantId,
            productName: 'Analytics product',
            sku: `ANALYTICS-${suffix}`,
            quantity: units,
            unitPrice: '300000000.00',
            listUnitPrice: '300000000.00',
            listCurrency: 'ARS',
            lineTotal,
          },
        },
      },
    })
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
    email = `analytics-${suffix}@example.test`
    priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    const parent = await prisma.category.create({ data: { name: 'Analytics parent', slug: `analytics-${suffix}` } })
    const child = await prisma.category.create({
      data: { name: 'Analytics child', slug: `analytics-child-${suffix}`, parentId: parent.id },
    })
    categoryIds = [child.id, parent.id]
    productId = (
      await prisma.product.create({
        data: { name: `Analytics ${suffix}`, slug: `analytics-${suffix}`, categoryId: child.id },
      })
    ).id
    variantId = (
      await prisma.productVariant.create({ data: { productId, sku: `ANALYTICS-${suffix}`, isDefault: true } })
    ).id
    adminCookie = await user(UserRole.ADMIN)
    customerCookie = await user(UserRole.CUSTOMER)
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      // Orders are never deleted (business rule): the test ones are cancelled and stay as history in cg_test.
      await prisma.order.updateMany({
        where: { contactEmail: email },
        data: { status: OrderStatus.CANCELLED, cancelledAt: now },
      })
      await prisma.productVariant.updateMany({ where: { productId }, data: { deletedAt: now } })
      await prisma.product.updateMany({ where: { id: productId }, data: { deletedAt: now } })
      await prisma.category.updateMany({ where: { id: { in: categoryIds } }, data: { deletedAt: now } })
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('is admin only', async () => {
    await request(app.getHttpServer()).get('/admin/analytics').expect(401)
    await request(app.getHttpServer()).get('/admin/analytics').set('Cookie', customerCookie).expect(403)
  })

  it('reports sales, outcomes, rankings and returning customers against the previous period', async () => {
    const before = await report()
    const now = Date.now()
    // Paid 40 days ago: previous period, and makes the customer a returning one in the current period.
    await order(OrderStatus.DELIVERED, new Date(now - 40 * DAY_MS), new Date(now - 40 * DAY_MS))
    // Paid two hours after placing it, now.
    await order(OrderStatus.CONFIRMED, new Date(now - 2 * 3_600_000), new Date(now), 2)
    await order(OrderStatus.EXPIRED, new Date(now), null)
    const after = await report()

    const delta = (a: { amount: string }, b: { amount: string }) => Number(a.amount) - Number(b.amount)
    expect(after.period.groupBy).toBe('day')
    expect(after.buckets).toHaveLength(30)
    expect(after.sales.series.current).toHaveLength(30)
    expect(delta(after.sales.current, before.sales.current)).toBeCloseTo(600_000_000, 2)
    expect(delta(after.sales.previous, before.sales.previous)).toBeCloseTo(300_000_000, 2)
    expect(Number(after.sales.series.current.at(-1)) - Number(before.sales.series.current.at(-1))).toBeCloseTo(
      600_000_000,
      2,
    )
    expect(after.orders.current - before.orders.current).toBe(1)
    expect(after.outcomes.current.placed - before.outcomes.current.placed).toBe(2)
    expect(after.outcomes.current.expired - before.outcomes.current.expired).toBe(1)
    expect(after.customers.total.current - before.customers.total.current).toBe(1)
    expect(after.customers.returning.current - before.customers.returning.current).toBe(1)

    const product = after.products.find(row => row.id === productId)
    expect(product).toMatchObject({ units: 2, archived: false, imageUrl: null })
    expect(product?.sales.amount).toBe('600000000.00')
    expect(product?.previousSales.amount).toBe('300000000.00')
    // The subcategory's sales count for its top-level category.
    expect(after.categories.find(row => row.id === categoryIds[1])?.sales.amount).toBe('600000000.00')
    expect(after.categories.some(row => row.id === categoryIds[0])).toBe(false)
    expect(after.buyerTypes.find(row => row.key === BuyerType.WHOLESALE)).toBeDefined()
  })

  it('groups by week or month and rejects invalid queries', async () => {
    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const yearAgo = new Date(Date.now() - 3 * 60 * 60 * 1000 - 300 * DAY_MS).toISOString().slice(0, 10)
    const monthly = await report(`?from=${yearAgo}&to=${today}`)
    expect(monthly.period.groupBy).toBe('month')
    expect(monthly.sales.series.previous).toHaveLength(monthly.buckets.length)
    const weekly = await report('?groupBy=week')
    expect(weekly.buckets.length).toBeGreaterThanOrEqual(5)
    const get = (query: string) =>
      request(app.getHttpServer()).get(`/admin/analytics${query}`).set('Cookie', adminCookie)
    await get('?groupBy=year').expect(400)
    await get(`?from=${today}`).expect(400)
    await get('?from=2026-02-30&to=2026-03-01').expect(400)
  })
})
