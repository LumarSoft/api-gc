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
import type { AdminDashboardDto } from '../src/dashboard/dto/dashboard-response.dto'
import { BuyerType, OrderStatus, ProductStatus, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Admin dashboard (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let adminCookie: string
  let customerCookie: string
  let priceListId: number
  let categoryId: number
  let suffix: string
  const userIds: number[] = []
  const productIds: number[] = []
  const summary = async (): Promise<AdminDashboardDto> =>
    (await request(app.getHttpServer()).get('/admin/dashboard').set('Cookie', adminCookie).expect(200))
      .body as AdminDashboardDto

  async function user(role: UserRole): Promise<string> {
    const created = await prisma.user.create({
      data: {
        email: `dashboard-${role.toLowerCase()}-${suffix}@example.test`,
        firstName: 'Dashboard',
        lastName: 'Test',
        role,
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    userIds.push(created.id)
    return `cg_at=${await app.get(JwtService).signAsync({ sub: created.id })}`
  }

  function order(status: OrderStatus, total: string, confirmedAt: Date | null) {
    return prisma.order.create({
      data: {
        number: `CG-9${randomBytes(4).readUInt32BE() % 1_000_000_000}`.slice(0, 13),
        buyerType: BuyerType.RETAIL,
        priceListId,
        status,
        paymentMethod: 'MANUAL',
        deliveryMethod: 'STORE_PICKUP',
        subtotal: total,
        total,
        contactEmail: `dashboard-${suffix}@example.test`,
        confirmedAt,
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
    priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    categoryId = (await prisma.category.create({ data: { name: 'Dashboard test', slug: `dashboard-${suffix}` } })).id
    adminCookie = await user(UserRole.ADMIN)
    customerCookie = await user(UserRole.CUSTOMER)
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      // Orders are never deleted (business rule): the test ones are cancelled and stay as history in cg_test.
      await prisma.order.updateMany({
        where: { contactEmail: `dashboard-${suffix}@example.test` },
        data: { status: OrderStatus.CANCELLED, cancelledAt: now },
      })
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('is admin only', async () => {
    await request(app.getHttpServer()).get('/admin/dashboard').expect(401)
    await request(app.getHttpServer()).get('/admin/dashboard').set('Cookie', customerCookie).expect(403)
  })

  it('counts paid sales, placed orders and drafts of the last 30 days', async () => {
    const before = await summary()
    expect(before.days).toHaveLength(30)
    expect(before.sales.daily).toHaveLength(30)
    await order(OrderStatus.CONFIRMED, '1000.50', new Date())
    await order(OrderStatus.PENDING_PAYMENT, '999.00', null)
    // Paid 40 days ago: belongs to the previous period, not the current one.
    await order(OrderStatus.DELIVERED, '200.00', new Date(Date.now() - 40 * 24 * 60 * 60 * 1000))
    const draft = await prisma.product.create({
      data: { name: `Dashboard ${suffix}`, slug: `dashboard-${suffix}`, categoryId, status: ProductStatus.DRAFT },
    })
    productIds.push(draft.id)

    const after = await summary()
    expect(Number(after.sales.current.amount) - Number(before.sales.current.amount)).toBeCloseTo(1000.5, 2)
    expect(Number(after.sales.previous.amount) - Number(before.sales.previous.amount)).toBeCloseTo(200, 2)
    expect(Number(after.sales.daily.at(-1)) - Number(before.sales.daily.at(-1))).toBeCloseTo(1000.5, 2)
    // The three test orders were placed now, so all count as placed in the current period.
    expect(after.orders.current - before.orders.current).toBe(3)
    expect(after.orders.daily.at(-1)! - before.orders.daily.at(-1)!).toBe(3)
    expect(after.averageOrder.current).not.toBeNull()
    expect(after.todo.drafts - before.todo.drafts).toBe(1)
  })

  it('takes a custom range of Argentine days and rejects invalid ones', async () => {
    const get = (query: string) =>
      request(app.getHttpServer()).get(`/admin/dashboard${query}`).set('Cookie', adminCookie)
    const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const ranged = (await get(`?from=${yesterday}&to=${today}`).expect(200)).body as AdminDashboardDto
    expect(ranged.days).toEqual([yesterday, today])
    expect(ranged.sales.daily).toHaveLength(2)
    await get(`?from=${yesterday}`).expect(400)
    await get(`?from=${today}&to=${yesterday}`).expect(400)
    await get('?from=2026-01-01&to=2999-01-01').expect(400)
    await get('?from=2026-02-30&to=2026-03-01').expect(400)
  })
})
