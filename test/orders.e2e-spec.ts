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
import { hashToken } from '../src/common/utils/secure-token'
import { BuyerType, CartStatus, OrderStatus, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type { CheckoutResponseDto } from '../src/checkout/dto/checkout-response.dto'
import type {
  MyOrdersPageDto,
  OrderCountsDto,
  OrderResponseDto,
  OrdersPageDto,
} from '../src/orders/dto/order-response.dto'
import { OrderStatusService } from '../src/orders/order-status.service'
import { OrderExpiryService } from '../src/orders/order-expiry.service'

describe('Guest orders (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let variantId: number
  let productId: number
  const fileIds: number[] = []
  let categoryId: number
  let priceListId: number
  let adminId: number
  let customerId: number
  let adminCookie: string
  let customerCookie: string
  let guestCookie: string
  const cartIds: number[] = []
  const orderIds: number[] = []
  const input = { name: 'Order Test', email: 'order@example.test', deliveryMethod: 'STORE_PICKUP' }
  const access = (): string => randomBytes(32).toString('hex')
  const body = (response: request.Response): OrderResponseDto => response.body as OrderResponseDto
  const change = (id: number, status: OrderStatus, paymentReceived?: boolean): request.Test =>
    request(app.getHttpServer())
      .put(`/admin/orders/${id}/status`)
      .set('Cookie', adminCookie)
      .send({ status, ...(paymentReceived ? { paymentReceived } : {}) })

  async function cart(quantity = 1): Promise<string> {
    const response = await request(app.getHttpServer()).post('/cart/items').send({ variantId, quantity }).expect(200)
    const raw: unknown = response.headers['set-cookie']
    const cookie = (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0]
    const token = cookie.split('=')[1]
    const saved = await prisma.cart.findUniqueOrThrow({ where: { guestToken: hashToken(token) }, select: { id: true } })
    cartIds.push(saved.id)
    return cookie
  }
  async function payload(
    cookie: string,
    accessToken = access(),
  ): Promise<typeof input & { accessToken: string; reviewToken: string }> {
    const response = await request(app.getHttpServer())
      .post('/cart/checkout/preview')
      .set('Cookie', cookie)
      .send(input)
      .expect(200)
    return { ...input, accessToken, reviewToken: (response.body as CheckoutResponseDto).reviewToken! }
  }
  async function place(cookie: string): Promise<{ order: OrderResponseDto; accessToken: string }> {
    const data = await payload(cookie)
    const response = await request(app.getHttpServer())
      .post('/cart/checkout/orders')
      .set('Cookie', cookie)
      .send(data)
      .expect(200)
    const order = body(response)
    orderIds.push(order.id)
    return { order, accessToken: data.accessToken }
  }

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
    priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    const passwordHash = await hash(access(), 10)
    const admin = await prisma.user.create({
      data: {
        email: `order-admin-${suffix}@example.test`,
        firstName: 'Order',
        lastName: 'Test',
        role: UserRole.ADMIN,
        passwordHash,
      },
    })
    const customer = await prisma.user.create({
      data: { email: `order-customer-${suffix}@example.test`, firstName: 'Order', lastName: 'Test', passwordHash },
    })
    adminId = admin.id
    customerId = customer.id
    const jwt = app.get(JwtService)
    adminCookie = `cg_at=${await jwt.signAsync({ sub: adminId })}`
    customerCookie = `cg_at=${await jwt.signAsync({ sub: customerId })}`
    categoryId = (await prisma.category.create({ data: { name: 'Order test', slug: `order-test-${suffix}` } })).id
    productId = (
      await prisma.product.create({
        data: { name: 'Order test product', slug: `order-product-${suffix}`, categoryId, status: 'PUBLISHED' },
      })
    ).id
    variantId = (
      await prisma.productVariant.create({
        data: {
          productId,
          sku: `ORDER-${suffix}`,
          isDefault: true,
          inventory: { create: { onHand: 20 } },
          prices: { create: { priceListId, amount: '12.35', currency: 'ARS' } },
        },
      })
    ).id
  })

  beforeEach(async () => {
    for (const id of orderIds) {
      const row = await prisma.order.findUnique({ where: { id }, select: { status: true } })
      if (row?.status === OrderStatus.PENDING_PAYMENT)
        await app
          .get(OrderStatusService)
          .change(id, { status: OrderStatus.CANCELLED }, { userId: adminId, ipAddress: null })
    }
    await prisma.inventoryLevel.update({ where: { variantId }, data: { onHand: 20, reserved: 0 } })
    await prisma.product.update({ where: { id: productId }, data: { name: 'Order test product', status: 'PUBLISHED' } })
    await prisma.variantPrice.update({
      where: { variantId_priceListId: { variantId, priceListId } },
      data: { amount: '12.35', currency: 'ARS' },
    })
    guestCookie = await cart(2)
  })

  afterAll(async () => {
    if (prisma) {
      for (const id of orderIds) {
        const row = await prisma.order.findUnique({ where: { id }, select: { status: true } })
        if (row?.status === OrderStatus.PENDING_PAYMENT)
          await app
            .get(OrderStatusService)
            .change(id, { status: OrderStatus.CANCELLED }, { userId: adminId, ipAddress: null })
      }
      const now = new Date()
      await prisma.cart.updateMany({ where: { id: { in: cartIds } }, data: { deletedAt: now, guestToken: null } })
      await prisma.productImage.updateMany({ where: { fileId: { in: fileIds } }, data: { deletedAt: now } })
      await prisma.storedFile.updateMany({ where: { id: { in: fileIds } }, data: { deletedAt: now } })
      await prisma.product.update({ where: { id: productId }, data: { deletedAt: now } })
      await prisma.productVariant.update({ where: { id: variantId }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.updateMany({ where: { id: { in: [adminId, customerId] } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('creates a guest snapshot, reserves stock, converts the cart and protects private tracking', async () => {
    const { order, accessToken } = await place(guestCookie)
    expect(order.total.amount).toBe('24.70')
    expect(order.status).toBe('PENDING_PAYMENT')
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(saved.userId).toBeNull()
    expect(saved.accessTokenHash).not.toBe(accessToken)
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(2)
    expect((await prisma.cart.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe(CartStatus.CONVERTED)
    await prisma.product.update({ where: { id: productId }, data: { name: 'Changed product' } })
    await prisma.variantPrice.update({
      where: { variantId_priceListId: { variantId, priceListId } },
      data: { amount: '99.99' },
    })
    const tracked = await request(app.getHttpServer())
      .post(`/orders/${order.number}/track`)
      .send({ accessToken })
      .expect(200)
    expect(body(tracked).items[0].name).toBe('Order test product')
    expect(body(tracked).items[0].imageUrl).toBeNull()
    // The thumbnail is the product's current first live image (archived ones are skipped).
    const image = async (key: string, sortOrder: number, deletedAt: Date | null = null): Promise<void> => {
      const file = await prisma.storedFile.create({
        data: { storageKey: key, originalName: 'foto.png', mimeType: 'image/png', sizeBytes: 1, visibility: 'PUBLIC' },
      })
      fileIds.push(file.id)
      await prisma.productImage.create({ data: { productId, fileId: file.id, sortOrder, deletedAt } })
    }
    const key = `test/orders-${randomUUID()}`
    await image(`${key}-second.png`, 1)
    await image(`${key}-first.png`, 0)
    await image(`${key}-archived.png`, -1, new Date())
    const withImage = await request(app.getHttpServer())
      .post(`/orders/${order.number}/track`)
      .send({ accessToken })
      .expect(200)
    expect(body(withImage).items[0].imageUrl).toMatch(new RegExp(`/${key}-first\\.png$`))
    expect(body(tracked).total.amount).toBe('24.70')
    expect(tracked.headers['cache-control']).toBe('private, no-store')
    expect(tracked.body).not.toHaveProperty('accessTokenHash')
    expect(tracked.body).not.toHaveProperty('internalNote')
    await request(app.getHttpServer()).post(`/orders/${order.number}/track`).send({ accessToken: access() }).expect(404)
    await request(app.getHttpServer()).post(`/orders/${order.number}/track`).send({ email: input.email }).expect(400)
    await request(app.getHttpServer()).get('/admin/orders').expect(401)
    await request(app.getHttpServer()).get('/admin/orders').set('Cookie', customerCookie).expect(403)
  })

  it('serializes duplicate confirmation and recovers a lost response without a cart cookie', async () => {
    const data = await payload(guestCookie)
    const send = () => request(app.getHttpServer()).post('/cart/checkout/orders').set('Cookie', guestCookie).send(data)
    const responses = await Promise.all([send(), send()])
    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(body(responses[0]).id).toBe(body(responses[1]).id)
    orderIds.push(body(responses[0]).id)
    expect(await prisma.stockReservation.count({ where: { orderId: body(responses[0]).id } })).toBe(1)
    const recovered = await request(app.getHttpServer())
      .post('/orders/recover')
      .send({ accessToken: data.accessToken })
      .expect(200)
    expect(body(recovered).id).toBe(body(responses[0]).id)
    await request(app.getHttpServer()).post('/orders/recover').send({ accessToken: access() }).expect(404)
  })

  it('rejects a stale price review, forged totals and unavailable delivery without reserving', async () => {
    const data = await payload(guestCookie)
    await request(app.getHttpServer())
      .post('/cart/checkout/orders')
      .set('Cookie', guestCookie)
      .send({ ...data, total: '0.01' })
      .expect(400)
    await prisma.variantPrice.update({
      where: { variantId_priceListId: { variantId, priceListId } },
      data: { amount: '20.00' },
    })
    await request(app.getHttpServer()).post('/cart/checkout/orders').set('Cookie', guestCookie).send(data).expect(409)
    await request(app.getHttpServer())
      .post('/cart/checkout/orders')
      .set('Cookie', guestCookie)
      .send({ ...data, deliveryMethod: 'CARRIER' })
      .expect(422)
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(0)
    expect((await place(guestCookie)).order.total.amount).toBe('40.00')
  })

  it('prevents two guests from reserving the same last units concurrently', async () => {
    const otherCookie = await cart(2)
    const first = await payload(guestCookie)
    const second = await payload(otherCookie)
    await prisma.inventoryLevel.update({ where: { variantId }, data: { onHand: 2 } })
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/cart/checkout/orders').set('Cookie', guestCookie).send(first),
      request(app.getHttpServer()).post('/cart/checkout/orders').set('Cookie', otherCookie).send(second),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([200, 422])
    orderIds.push(body(responses.find(response => response.status === 200)!).id)
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(2)
  })

  it('requires verified payment, consumes stock exactly once, audits and advances pickup tracking', async () => {
    const { order, accessToken } = await place(guestCookie)
    await change(order.id, OrderStatus.PREPARING).expect(422)
    await change(order.id, OrderStatus.CONFIRMED).expect(422)
    const results = await Promise.all([
      change(order.id, OrderStatus.CONFIRMED, true),
      change(order.id, OrderStatus.CONFIRMED, true),
    ])
    expect(results.map(response => response.status).sort()).toEqual([200, 422])
    expect(await prisma.payment.count({ where: { orderId: order.id, provider: 'MANUAL', status: 'APPROVED' } })).toBe(1)
    expect(
      await prisma.auditLog.count({ where: { entityId: order.id, entityType: 'Order', action: 'order.status' } }),
    ).toBe(1)
    const stock = await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })
    expect(stock.reserved).toBe(0)
    expect(stock.onHand).toBe(18)
    await change(order.id, OrderStatus.PREPARING).expect(200)
    await change(order.id, OrderStatus.SHIPPED).expect(422)
    await change(order.id, OrderStatus.READY_FOR_PICKUP).expect(200)
    await change(order.id, OrderStatus.DELIVERED).expect(200)
    const tracked = body(
      await request(app.getHttpServer()).post(`/orders/${order.number}/track`).send({ accessToken }).expect(200),
    )
    expect(tracked.history.map(event => event.status)).toEqual([
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'DELIVERED',
    ])
  })

  it('releases a cancellation once and automatically expires overdue reservations', async () => {
    const { order } = await place(guestCookie)
    await change(order.id, OrderStatus.CANCELLED).expect(200)
    await change(order.id, OrderStatus.CANCELLED).expect(422)
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(0)
    expect(await prisma.stockMovement.count({ where: { orderId: order.id, reason: 'RESERVATION_RELEASE' } })).toBe(1)
    const expired = (await place(await cart(1))).order
    await prisma.order.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 5000) } })
    await change(expired.id, OrderStatus.CONFIRMED, true).expect(422)
    await app.get(OrderExpiryService).run()
    expect((await prisma.order.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe('EXPIRED')
    expect((await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })).reserved).toBe(0)
    expect((await prisma.stockReservation.findFirstOrThrow({ where: { orderId: expired.id } })).status).toBe('EXPIRED')
    await app.get(OrderExpiryService).run()
    expect(await prisma.stockMovement.count({ where: { orderId: expired.id, reason: 'RESERVATION_RELEASE' } })).toBe(1)
    const listed = (
      await request(app.getHttpServer())
        .get('/admin/orders?status=EXPIRED&pageSize=1')
        .set('Cookie', adminCookie)
        .expect(200)
    ).body as OrdersPageDto
    expect(listed.items).toHaveLength(1)
    expect(listed.total).toBeGreaterThanOrEqual(1)
    expect(listed.expiryJobFailed).toBe(false)
  })

  it('searches and groups orders for staff, and keeps staff notes out of tracking', async () => {
    const { order, accessToken } = await place(guestCookie)
    const admin = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', adminCookie)
    const before = (await admin('/admin/orders/counts').expect(200)).body as OrderCountsDto
    expect(before.PENDING_PAYMENT).toBeGreaterThanOrEqual(1)
    await request(app.getHttpServer()).get('/admin/orders/counts').set('Cookie', customerCookie).expect(403)

    const byNumber = (await admin(`/admin/orders?q=${order.number.slice(-6)}`).expect(200)).body as OrdersPageDto
    expect(byNumber.items.map(item => item.id)).toContain(order.id)
    const pending = (await admin(`/admin/orders?stage=PENDING_PAYMENT&q=${order.number}`).expect(200))
      .body as OrdersPageDto
    expect(pending.items.map(item => item.id)).toEqual([order.id])
    expect(pending.items[0].guest).toBe(true)
    const closed = (await admin(`/admin/orders?stage=CLOSED&q=${order.number}`).expect(200)).body as OrdersPageDto
    expect(closed.items).toHaveLength(0)
    await admin('/admin/orders?stage=OPEN').expect(400)

    await request(app.getHttpServer())
      .put(`/admin/orders/${order.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: OrderStatus.CANCELLED, note: 'Pidió cancelar por WhatsApp' })
      .expect(200)
    const read = body(await admin(`/admin/orders/${order.id}`).expect(200))
    expect(read.history.at(-1)).toMatchObject({
      status: 'CANCELLED',
      note: 'Pidió cancelar por WhatsApp',
      by: 'Order Test',
    })
    expect(read.history[0].by).toBeNull()
    const after = (await admin('/admin/orders/counts').expect(200)).body as OrderCountsDto
    expect(after.PENDING_PAYMENT).toBe(before.PENDING_PAYMENT - 1)

    const tracked = body(
      await request(app.getHttpServer()).post(`/orders/${order.number}/track`).send({ accessToken }).expect(200),
    )
    expect(tracked.history.at(-1)).toEqual({ status: 'CANCELLED', at: expect.any(String) as string })
    expect(tracked).not.toHaveProperty('guest')
  })

  it("lists and reads a signed-in customer's own orders, never a guest's or another account's", async () => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 1 })
      .expect(200)
    const customerCart = await prisma.cart.findFirstOrThrow({
      where: { userId: customerId, status: CartStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    })
    cartIds.push(customerCart.id)
    const first = await place(customerCookie)
    await request(app.getHttpServer())
      .post('/cart/items')
      .set('Cookie', customerCookie)
      .send({ variantId, quantity: 3 })
      .expect(200)
    const secondCart = await prisma.cart.findFirstOrThrow({
      where: { userId: customerId, status: CartStatus.ACTIVE, deletedAt: null },
      select: { id: true },
    })
    cartIds.push(secondCart.id)
    const second = await place(customerCookie)
    const guest = await place(guestCookie)
    const mine = (path: string, cookie = customerCookie) => request(app.getHttpServer()).get(path).set('Cookie', cookie)

    const page = (await mine('/orders/mine').expect(200)).body as MyOrdersPageDto
    expect(page.items.map(item => item.number)).toEqual([second.order.number, first.order.number])
    expect(page).toMatchObject({ page: 1, pageSize: 10, total: 2, totalPages: 1 })
    expect(page.items[0].items[0].quantity).toBe(3)
    expect(page.items[0]).not.toHaveProperty('guest')
    expect(page.items[0]).not.toHaveProperty('allowedStatuses')
    const paged = (await mine('/orders/mine?page=2&pageSize=1').expect(200)).body as MyOrdersPageDto
    expect(paged.items.map(item => item.number)).toEqual([first.order.number])
    expect(paged.totalPages).toBe(2)
    await mine('/orders/mine?pageSize=51').expect(400)
    await mine('/orders/mine?page=99999999999999999999').expect(400)

    const read = await mine(`/orders/mine/${first.order.number}`).expect(200)
    expect(read.headers['cache-control']).toBe('private, no-store')
    expect(body(read)).toMatchObject({ number: first.order.number, status: 'PENDING_PAYMENT' })
    expect(body(read).history[0]).toEqual({ status: 'PENDING_PAYMENT', at: expect.any(String) as string })
    await mine(`/orders/mine/${guest.order.number}`).expect(404)
    await mine('/orders/mine/not-a-number').expect(400)
    await request(app.getHttpServer()).get('/orders/mine').expect(401)
    await request(app.getHttpServer()).get(`/orders/mine/${first.order.number}`).expect(401)

    const other = await prisma.user.create({
      data: {
        email: `order-other-${randomUUID().slice(0, 8)}@example.test`,
        firstName: 'Other',
        lastName: 'Test',
        passwordHash: await hash(access(), 10),
      },
    })
    try {
      const otherCookie = `cg_at=${await app.get(JwtService).signAsync({ sub: other.id })}`
      expect(((await mine('/orders/mine', otherCookie).expect(200)).body as MyOrdersPageDto).total).toBe(0)
      await mine(`/orders/mine/${first.order.number}`, otherCookie).expect(404)
    } finally {
      await prisma.user.update({ where: { id: other.id }, data: { deletedAt: new Date() } })
    }
  })
})
