import { INestApplication, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from '../src/app.module'
import type { CartResponseDto } from '../src/cart/dto/cart-response.dto'
import type { CheckoutResponseDto } from '../src/checkout/dto/checkout-response.dto'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { generateSecureToken, hashToken } from '../src/common/utils/secure-token'
import {
  BuyerType,
  CartStatus,
  Currency,
  ProductStatus,
  TaxCondition,
  WholesaleStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'

// Real transactions against local MySQL. All modified catalog/user data belongs to this suite; cleanup is soft delete.
describe('Cart (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let variantId: number
  let productId: number
  let categoryId: number
  let wholesaleListId: number
  let retailListId: number
  let companyId: number
  let wholesaleUserId: number
  let retailUserId: number
  let wholesaleCookie: string
  let retailCookie: string
  let guestCookie: string
  let guestId: number
  const cartIds: number[] = []

  const body = (response: request.Response): CartResponseDto => response.body as CartResponseDto
  const post = (cookie: string, quantity = 1): request.Test =>
    request(app.getHttpServer()).post('/cart/items').set('Cookie', cookie).send({ variantId, quantity })

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = fixture.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    // Bind 127.0.0.1 explicitly: supertest connects there, and an unbound app would get a port that another local
    // process may already hold on 127.0.0.1 (random 401s from that process on macOS).
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)
    const suffix = randomUUID().slice(0, 8)
    const retail = await prisma.priceList.findFirstOrThrow({
      where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
    })
    retailListId = retail.id
    const list = await prisma.priceList.create({
      data: { name: 'Cart test list', code: `CART-${suffix}`, audience: BuyerType.WHOLESALE },
    })
    wholesaleListId = list.id
    const company = await prisma.company.create({
      data: {
        legalName: 'Cart test company',
        cuit: String(Date.now()).slice(-11),
        taxCondition: TaxCondition.MONOTRIBUTISTA,
        email: `cart-company-${suffix}@example.test`,
        wholesaleStatus: WholesaleStatus.APPROVED,
        priceListId: list.id,
      },
    })
    companyId = company.id
    const passwordHash = await hash(generateSecureToken(), 10)
    const wholesale = await prisma.user.create({
      data: {
        email: `cart-wholesale-${suffix}@example.test`,
        passwordHash,
        firstName: 'Cart',
        lastName: 'Test',
        companyId,
      },
    })
    const retailUser = await prisma.user.create({
      data: { email: `cart-retail-${suffix}@example.test`, passwordHash, firstName: 'Cart', lastName: 'Test' },
    })
    wholesaleUserId = wholesale.id
    retailUserId = retailUser.id
    const jwt = app.get(JwtService)
    wholesaleCookie = `cg_at=${await jwt.signAsync({ sub: wholesale.id })}`
    retailCookie = `cg_at=${await jwt.signAsync({ sub: retailUser.id })}`
    const category = await prisma.category.create({ data: { name: 'Cart test', slug: `cart-test-${suffix}` } })
    categoryId = category.id
    const product = await prisma.product.create({
      data: {
        name: 'Cart test product',
        slug: `cart-test-product-${suffix}`,
        categoryId,
        status: ProductStatus.PUBLISHED,
      },
    })
    productId = product.id
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        sku: `CART-${suffix}`,
        isDefault: true,
        inventory: { create: { onHand: 20, reserved: 2 } },
        prices: {
          create: [
            { priceListId: retail.id, amount: '12.35', currency: Currency.ARS },
            { priceListId: list.id, amount: '9.10', currency: Currency.ARS },
          ],
        },
      },
    })
    variantId = variant.id
  })

  beforeEach(async () => {
    const now = new Date()
    const previous = await prisma.cart.findMany({
      where: { userId: { in: [wholesaleUserId, retailUserId] } },
      select: { id: true },
    })
    cartIds.push(...previous.map(cart => cart.id))
    await prisma.cartItem.updateMany({ where: { cartId: { in: cartIds } }, data: { deletedAt: now } })
    await prisma.cart.updateMany({ where: { id: { in: cartIds } }, data: { deletedAt: now, guestToken: null } })
    await prisma.product.update({ where: { id: productId }, data: { status: ProductStatus.PUBLISHED } })
    await prisma.inventoryLevel.update({ where: { variantId }, data: { onHand: 20, reserved: 2 } })
    await prisma.variantPrice.update({
      where: { variantId_priceListId: { variantId, priceListId: retailListId } },
      data: { amount: '12.35', currency: Currency.ARS, deletedAt: null },
    })
    const token = generateSecureToken()
    const guest = await prisma.cart.create({ data: { guestToken: hashToken(token) } })
    guestId = guest.id
    cartIds.push(guestId)
    guestCookie = `cg_cart=${token}`
  })

  afterAll(async () => {
    if (!prisma) {
      if (app) await app.close()
      return
    }
    const now = new Date()
    const userIds = [wholesaleUserId, retailUserId].filter((id): id is number => typeof id === 'number')
    const owned = await prisma.cart.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    })
    cartIds.push(...owned.map(cart => cart.id))
    await prisma.cartItem.updateMany({ where: { cartId: { in: cartIds } }, data: { deletedAt: now } })
    await prisma.cart.updateMany({ where: { id: { in: cartIds } }, data: { deletedAt: now, guestToken: null } })
    // A failed setup must never turn an undefined fixture id into an unfiltered updateMany.
    if (variantId) {
      await prisma.variantPrice.updateMany({ where: { variantId }, data: { deletedAt: now } })
      await prisma.inventoryLevel.updateMany({ where: { variantId }, data: { deletedAt: now } })
      await prisma.productVariant.updateMany({ where: { id: variantId }, data: { deletedAt: now } })
    }
    if (productId) await prisma.product.updateMany({ where: { id: productId }, data: { deletedAt: now } })
    if (categoryId) await prisma.category.updateMany({ where: { id: categoryId }, data: { deletedAt: now } })
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    if (companyId) await prisma.company.updateMany({ where: { id: companyId }, data: { deletedAt: now } })
    if (wholesaleListId) await prisma.priceList.updateMany({ where: { id: wholesaleListId }, data: { deletedAt: now } })
    await app.close()
  })

  it('does not create carts or cookies just for visiting the store', async () => {
    const before = await prisma.cart.count()
    const response = await request(app.getHttpServer()).get('/cart').expect(200)
    expect(body(response)).toEqual({
      items: [],
      itemCount: 0,
      subtotal: { amount: '0.00', currency: 'ARS' },
      hasIssues: false,
    })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(await prisma.cart.count()).toBe(before)
  })

  it('previews the owned cart with current prices without placing an order or reserving stock', async () => {
    await post(guestCookie, 2).expect(200)
    const beforeOrders = await prisma.order.count()
    const preview = await request(app.getHttpServer())
      .post('/cart/checkout/preview')
      .set('Cookie', guestCookie)
      .send({ name: 'Checkout Test', email: 'checkout@example.test', deliveryMethod: 'STORE_PICKUP' })
      .expect(200)
    const checkout = preview.body as CheckoutResponseDto
    expect(checkout.cart.itemCount).toBe(2)
    expect(checkout.total).toEqual({ amount: '24.70', currency: 'ARS' })
    expect(checkout.shippingTotal?.amount).toBe('0.00')
    expect(checkout.customer?.name).toBe('Checkout Test')
    expect(preview.headers['cache-control']).toBe('private, no-store')
    expect(await prisma.order.count()).toBe(beforeOrders)
    expect(await prisma.stockReservation.count({ where: { variantId } })).toBe(0)
    const stranger = await request(app.getHttpServer()).get('/cart/checkout').expect(200)
    expect((stranger.body as CheckoutResponseDto).cart.items).toEqual([])
    expect((stranger.body as CheckoutResponseDto).customer).toBeNull()
  })

  it('rejects empty checkout, forged amounts, invalid contact data and unavailable shipping', async () => {
    const input = { name: 'Checkout Test', email: 'checkout@example.test', deliveryMethod: 'STORE_PICKUP' }
    const preview = () => request(app.getHttpServer()).post('/cart/checkout/preview').set('Cookie', guestCookie)
    await preview().send(input).expect(422)
    await post(guestCookie).expect(200)
    await preview()
      .send({ ...input, total: '0.01' })
      .expect(400)
    await preview()
      .send({ ...input, email: 'bad' })
      .expect(400)
    await preview()
      .send({ ...input, name: '   ' })
      .expect(400)
    await preview()
      .send({ ...input, shippingAddress: [] })
      .expect(400)
    await preview()
      .send({ ...input, deliveryMethod: 'CARRIER' })
      .expect(422)
    await prisma.inventoryLevel.update({ where: { variantId }, data: { onHand: 2 } })
    await preview().send(input).expect(422)
  })

  it('creates a private guest cookie and stores only its hash on the first add', async () => {
    const response = await request(app.getHttpServer()).post('/cart/items').send({ variantId, quantity: 1 }).expect(200)
    const raw: unknown = response.headers['set-cookie']
    const cookie = Array.isArray(raw) ? String(raw[0]) : String(raw)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/cart')
    expect(cookie).toContain('SameSite=Lax')
    const token = cookie.split(';')[0].split('=')[1]
    const stored = await prisma.cart.findUniqueOrThrow({ where: { guestToken: hashToken(token) } })
    cartIds.push(stored.id)
    expect(stored.guestToken).not.toBe(token)
    expect(body(response).subtotal?.amount).toBe('12.35')
  })

  it('adds, updates, removes and restores a guest line without duplicates or stock reservations', async () => {
    await post(guestCookie, 2).expect(200)
    expect(body(await post(guestCookie, 1).expect(200)).items[0].quantity).toBe(3)
    const updated = await request(app.getHttpServer())
      .patch(`/cart/items/${variantId}`)
      .set('Cookie', guestCookie)
      .send({ quantity: 5 })
      .expect(200)
    expect(body(updated).subtotal?.amount).toBe('61.75')
    await request(app.getHttpServer()).delete(`/cart/items/${variantId}`).set('Cookie', guestCookie).expect(200)
    expect(body(await post(guestCookie).expect(200)).itemCount).toBe(1)
    expect(await prisma.cartItem.count({ where: { cartId: guestId, variantId } })).toBe(1)
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(2)
    expect(await prisma.stockReservation.count({ where: { variantId } })).toBe(0)
  })

  it('isolates guests and authenticated owners, including a stale claimed guest token', async () => {
    await post(guestCookie, 2).expect(200)
    const claimed = await request(app.getHttpServer())
      .get('/cart')
      .set('Cookie', `${wholesaleCookie}; ${guestCookie}`)
      .expect(200)
    expect(body(claimed).itemCount).toBe(2)
    expect(body(await request(app.getHttpServer()).get('/cart').set('Cookie', guestCookie).expect(200)).itemCount).toBe(
      0,
    )
    expect(
      body(await request(app.getHttpServer()).get('/cart').set('Cookie', retailCookie).expect(200)).itemCount,
    ).toBe(0)
    await request(app.getHttpServer()).delete(`/cart/items/${variantId}`).set('Cookie', retailCookie).expect(404)
    expect(
      body(await request(app.getHttpServer()).get('/cart').set('Cookie', wholesaleCookie).expect(200)).itemCount,
    ).toBe(2)
  })

  it('merges an existing owner cart once and reprices it for the approved company', async () => {
    await post(wholesaleCookie, 2).expect(200)
    await post(guestCookie, 3).expect(200)
    const cookie = `${wholesaleCookie}; ${guestCookie}`
    const merged = body(await request(app.getHttpServer()).get('/cart').set('Cookie', cookie).expect(200))
    expect(merged.itemCount).toBe(5)
    expect(merged.subtotal?.amount).toBe('45.50')
    expect(body(await request(app.getHttpServer()).get('/cart').set('Cookie', cookie).expect(200)).itemCount).toBe(5)
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: guestId } })).deletedAt).not.toBeNull()
  })

  it('serializes concurrent first writes for an owner and increments without losing items', async () => {
    const responses = await Promise.all([post(retailCookie, 2), post(retailCookie, 3)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(
      body(await request(app.getHttpServer()).get('/cart').set('Cookie', retailCookie).expect(200)).itemCount,
    ).toBe(5)
    expect(
      await prisma.cart.count({ where: { userId: retailUserId, deletedAt: null, status: CartStatus.ACTIVE } }),
    ).toBe(1)
  })

  it('serializes concurrent guest writes on the cart row', async () => {
    const responses = await Promise.all([post(guestCookie, 2), post(guestCookie, 3)])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(body(await request(app.getHttpServer()).get('/cart').set('Cookie', guestCookie).expect(200)).itemCount).toBe(
      5,
    )
  })

  it('rejects excess stock, invalid quantities and client-supplied prices or ownership', async () => {
    await post(guestCookie, 19).expect(422)
    for (const quantity of [0, -1, 1.5, '2', 1_000_001]) {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set('Cookie', guestCookie)
        .send({ variantId, quantity })
        .expect(400)
    }
    await request(app.getHttpServer())
      .post('/cart/items')
      .set('Cookie', guestCookie)
      .send({ variantId, quantity: 1, amount: '0.01', userId: wholesaleUserId })
      .expect(400)
    expect(body(await request(app.getHttpServer()).get('/cart').set('Cookie', guestCookie).expect(200)).itemCount).toBe(
      0,
    )
  })

  it('returns 401 for an invalid session instead of modifying an anonymous cart', async () => {
    await post(`cg_at=invalid; ${guestCookie}`).expect(401)
    expect(await prisma.cartItem.count({ where: { cartId: guestId } })).toBe(0)
  })

  it('recomputes prices and flags stock changes while allowing quantity reduction', async () => {
    await post(guestCookie, 5).expect(200)
    await prisma.variantPrice.update({
      where: { variantId_priceListId: { variantId, priceListId: retailListId } },
      data: { amount: '20.10' },
    })
    await prisma.inventoryLevel.update({ where: { variantId }, data: { onHand: 4 } })
    const cart = body(await request(app.getHttpServer()).get('/cart').set('Cookie', guestCookie).expect(200))
    expect(cart.subtotal?.amount).toBe('100.50')
    expect(cart.items[0].issue).toBe('INSUFFICIENT_STOCK')
    expect(cart.items[0].availableQuantity).toBe(2)
    await request(app.getHttpServer())
      .patch(`/cart/items/${variantId}`)
      .set('Cookie', guestCookie)
      .send({ quantity: 4 })
      .expect(200)
    const repaired = body(
      await request(app.getHttpServer())
        .patch(`/cart/items/${variantId}`)
        .set('Cookie', guestCookie)
        .send({ quantity: 2 })
        .expect(200),
    )
    expect(repaired.hasIssues).toBe(false)
  })

  it('keeps unpublished or unpriced items visible, rejects new adds, and supports clearing', async () => {
    await post(guestCookie).expect(200)
    await prisma.product.update({ where: { id: productId }, data: { status: ProductStatus.HIDDEN } })
    expect(
      body(await request(app.getHttpServer()).get('/cart').set('Cookie', guestCookie).expect(200)).items[0].issue,
    ).toBe('UNAVAILABLE')
    await post(guestCookie).expect(422)
    await prisma.product.update({ where: { id: productId }, data: { status: ProductStatus.PUBLISHED } })
    await prisma.variantPrice.update({
      where: { variantId_priceListId: { variantId, priceListId: retailListId } },
      data: { deletedAt: new Date() },
    })
    const cart = body(await request(app.getHttpServer()).get('/cart').set('Cookie', guestCookie).expect(200))
    expect(cart.items[0].issue).toBe('NO_PRICE')
    expect(cart.subtotal).toBeNull()
    expect(
      body(await request(app.getHttpServer()).delete('/cart').set('Cookie', guestCookie).expect(200)).itemCount,
    ).toBe(0)
  })
})
