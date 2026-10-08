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
import { BuyerType, ProductStatus, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type { BulkProductsResultDto } from '../src/products/dto/admin/bulk-products.dto'

describe('Admin bulk product actions (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let adminCookie: string
  let customerCookie: string
  let categoryId: number
  let priceListId: number
  let suffix: string
  const userIds: number[] = []
  const productIds: number[] = []
  const bulk = (body: object, cookie = adminCookie): request.Test =>
    request(app.getHttpServer()).post('/admin/products/bulk').set('Cookie', cookie).send(body)

  async function product(status: ProductStatus, withPrice: boolean, publishedAt: Date | null = null): Promise<number> {
    const key = `${suffix}-${productIds.length}`
    const created = await prisma.product.create({
      data: {
        name: `Bulk ${key}`,
        slug: `bulk-${key}`,
        categoryId,
        status,
        publishedAt,
        variants: {
          create: {
            sku: `BULK-${key}`.toUpperCase(),
            isDefault: true,
            ...(withPrice ? { prices: { create: { priceListId, amount: '10.00', currency: 'ARS' } } } : {}),
          },
        },
      },
      select: { id: true },
    })
    productIds.push(created.id)
    return created.id
  }

  async function user(role: UserRole): Promise<string> {
    const created = await prisma.user.create({
      data: {
        email: `bulk-${role.toLowerCase()}-${suffix}@example.test`,
        firstName: 'Bulk',
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
    priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    categoryId = (await prisma.category.create({ data: { name: 'Bulk test', slug: `bulk-test-${suffix}` } })).id
    adminCookie = await user(UserRole.ADMIN)
    customerCookie = await user(UserRole.CUSTOMER)
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      await prisma.productVariant.updateMany({ where: { productId: { in: productIds } }, data: { deletedAt: now } })
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('is admin only and validates the request', async () => {
    const id = await product(ProductStatus.DRAFT, true)
    await request(app.getHttpServer())
      .post('/admin/products/bulk')
      .send({ ids: [id], action: 'HIDE' })
      .expect(401)
    await bulk({ ids: [id], action: 'HIDE' }, customerCookie).expect(403)
    await bulk({ ids: [], action: 'HIDE' }).expect(400)
    await bulk({ ids: Array.from({ length: 101 }, (_, index) => index + 1), action: 'HIDE' }).expect(400)
    await bulk({ ids: [id], action: 'DELETE' }).expect(400)
    await request(app.getHttpServer())
      .get('/admin/products?page=99999999999999999999')
      .set('Cookie', adminCookie)
      .expect(400)
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).status).toBe(ProductStatus.DRAFT)
  })

  it('publishes the ready ones, skips blocked and missing ids, keeps the first publication date and audits', async () => {
    const firstPublished = new Date('2024-05-01T12:00:00Z')
    const ready = await product(ProductStatus.HIDDEN, true, firstPublished)
    const noPrice = await product(ProductStatus.DRAFT, false)
    const live = await product(ProductStatus.PUBLISHED, true, new Date())
    const result = (await bulk({ ids: [ready, noPrice, live, 999_999_999], action: 'PUBLISH' }).expect(200))
      .body as BulkProductsResultDto
    expect(result).toEqual({
      updated: [ready],
      unchanged: [live],
      skipped: [
        { id: noPrice, reason: 'CANNOT_PUBLISH', issues: ['NO_RETAIL_PRICE'] },
        { id: 999_999_999, reason: 'NOT_FOUND' },
      ],
    })
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: ready } })
    expect(saved.status).toBe(ProductStatus.PUBLISHED)
    expect(saved.publishedAt?.toISOString()).toBe(firstPublished.toISOString())
    expect((await prisma.product.findUniqueOrThrow({ where: { id: noPrice } })).status).toBe(ProductStatus.DRAFT)
    expect(
      await prisma.auditLog.count({ where: { entityType: 'Product', entityId: ready, action: 'product.status' } }),
    ).toBe(1)
  })

  it('hides and archives several products in one request', async () => {
    const first = await product(ProductStatus.PUBLISHED, true, new Date())
    const second = await product(ProductStatus.DRAFT, false)
    const hidden = (await bulk({ ids: [first, second], action: 'HIDE' }).expect(200)).body as BulkProductsResultDto
    expect(hidden.updated.sort()).toEqual([first, second].sort())
    const archived = (await bulk({ ids: [first, second], action: 'ARCHIVE' }).expect(200)).body as BulkProductsResultDto
    expect(archived.updated.sort()).toEqual([first, second].sort())
    expect(await prisma.product.count({ where: { id: { in: [first, second] }, deletedAt: null } })).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'Product', entityId: { in: [first, second] }, action: 'product.archive' },
      }),
    ).toBe(2)
    const again = (await bulk({ ids: [first], action: 'HIDE' }).expect(200)).body as BulkProductsResultDto
    expect(again.skipped).toEqual([{ id: first, reason: 'NOT_FOUND' }])
  })
})
