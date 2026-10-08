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
import type { FavoritesResponseDto } from '../src/favorites/dto/favorites-response.dto'
import { BuyerType } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type { PaginatedProductsDto } from '../src/products/dto/product-response.dto'

describe('Favorites and offers (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let customerId: number
  let customerCookie: string
  let categoryId: number
  let categorySlug: string
  let offerId: number
  let regularId: number
  let priceListId: number
  const productIds: number[] = []
  const server = (): App => app.getHttpServer()
  const favorites = async (): Promise<number[]> =>
    (
      (await request(server()).get('/favorites').set('Cookie', customerCookie).expect(200)).body as FavoritesResponseDto
    ).items.map(item => item.id)

  async function product(name: string, amount: string, compareAtAmount: string | null): Promise<number> {
    const created = await prisma.product.create({
      data: {
        name,
        slug: `${categorySlug}-${productIds.length}`,
        categoryId,
        status: 'PUBLISHED',
        publishedAt: new Date('2020-01-01'),
        variants: {
          create: {
            sku: `${categorySlug}-${productIds.length}`.toUpperCase(),
            isDefault: true,
            inventory: { create: { onHand: 5 } },
            prices: { create: { priceListId, amount, currency: 'ARS', compareAtAmount } },
          },
        },
      },
      select: { id: true },
    })
    productIds.push(created.id)
    return created.id
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
    const suffix = randomUUID().slice(0, 8)
    priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    const customer = await prisma.user.create({
      data: {
        email: `favorites-${suffix}@example.test`,
        firstName: 'Favorites',
        lastName: 'Test',
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    customerId = customer.id
    customerCookie = `cg_at=${await app.get(JwtService).signAsync({ sub: customerId })}`
    categorySlug = `favorites-test-${suffix}`
    categoryId = (await prisma.category.create({ data: { name: 'Favorites test', slug: categorySlug } })).id
    offerId = await product('Offer product', '100.00', '120.00')
    regularId = await product('Regular product', '100.00', null)
    await product('Wrong previous price', '100.00', '90.00')
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      await prisma.favorite.deleteMany({ where: { userId: customerId } })
      await prisma.productVariant.updateMany({ where: { productId: { in: productIds } }, data: { deletedAt: now } })
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.update({ where: { id: customerId }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('lists only products whose price for this buyer is below a higher previous price', async () => {
    const response = await request(server()).get(`/products?onSale=true&category=${categorySlug}`).expect(200)
    const page = response.body as PaginatedProductsDto
    expect(page.items.map(item => item.id)).toEqual([offerId])
    expect(page.items[0].badge).toBe('OFFER')
    expect(page.total).toBe(1)
    const all = (await request(server()).get(`/products?category=${categorySlug}`).expect(200))
      .body as PaginatedProductsDto
    expect(all.total).toBe(3)
    await request(server()).get('/products?page=99999999999999999999').expect(400)
  })

  it('requires a session for favorites', async () => {
    await request(server()).get('/favorites').expect(401)
    await request(server()).put(`/favorites/${offerId}`).expect(401)
  })

  it('saves favorites idempotently, newest first, and removes them idempotently', async () => {
    await request(server()).put(`/favorites/${offerId}`).set('Cookie', customerCookie).expect(204)
    await request(server()).put(`/favorites/${regularId}`).set('Cookie', customerCookie).expect(204)
    await request(server()).put(`/favorites/${offerId}`).set('Cookie', customerCookie).expect(204)
    expect(await favorites()).toEqual([regularId, offerId])
    expect(await prisma.favorite.count({ where: { userId: customerId } })).toBe(2)

    await request(server()).delete(`/favorites/${regularId}`).set('Cookie', customerCookie).expect(204)
    await request(server()).delete(`/favorites/${regularId}`).set('Cookie', customerCookie).expect(204)
    expect(await favorites()).toEqual([offerId])
  })

  it('rejects unknown or unpublished products and hides favorites that stop being visible', async () => {
    await request(server()).put('/favorites/999999999').set('Cookie', customerCookie).expect(404)
    await request(server()).put('/favorites/abc').set('Cookie', customerCookie).expect(400)
    await prisma.product.update({ where: { id: offerId }, data: { status: 'DRAFT' } })
    await request(server()).put(`/favorites/${offerId}`).set('Cookie', customerCookie).expect(404)
    expect(await favorites()).not.toContain(offerId)
    await prisma.product.update({ where: { id: offerId }, data: { status: 'PUBLISHED' } })
    expect(await favorites()).toContain(offerId)
  })
})
