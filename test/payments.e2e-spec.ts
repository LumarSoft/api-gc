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
import type { CheckoutResponseDto } from '../src/checkout/dto/checkout-response.dto'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { BuyerType, OrderStatus, PaymentStatus, UserRole } from '../src/generated/prisma/enums'
import {
  PAYMENT_GATEWAY,
  PaymentGatewayError,
  type CheckoutRequest,
  type GatewayPayment,
  type PaymentGateway,
} from '../src/mercado-pago/payment-gateway'
import type { OrderResponseDto } from '../src/orders/dto/order-response.dto'
import { OrderStatusService } from '../src/orders/order-status.service'
import { PrismaService } from '../src/prisma/prisma.service'

const SIGNATURE = 'valid-signature'

/** Stands in for Mercado Pago: the suite checks our flow, never the provider. */
function fakeGateway() {
  const payments = new Map<string, GatewayPayment>()
  const checkouts: CheckoutRequest[] = []
  const state = { down: false }
  // Unique per run: the e2e database keeps the payments of earlier runs and `externalId` is unique per provider.
  let next = Date.now()
  const gateway: PaymentGateway = {
    configured: true,
    createCheckout: checkout => {
      checkouts.push(checkout)
      return Promise.resolve(`https://mercadopago.example/checkout/${checkouts.length}`)
    },
    getPayment: id => {
      if (state.down) return Promise.reject(new PaymentGatewayError('UNAVAILABLE', 'down'))
      const payment = payments.get(id)
      return payment ? Promise.resolve(payment) : Promise.reject(new PaymentGatewayError('NOT_FOUND', 'missing'))
    },
    findPayments: reference =>
      Promise.resolve([...payments.values()].filter(payment => payment.reference === reference).reverse()),
    readNotification: ({ signature, query, body }) => {
      if (signature !== SIGNATURE) return 'UNAUTHORIZED'
      const paymentId = new URLSearchParams(query).get('data.id')
      const id = (body as { id?: number }).id
      return paymentId && id ? { notificationId: String(id), topic: 'payment', paymentId } : 'IGNORED'
    },
  }
  const pay = (reference: string, patch: Partial<GatewayPayment> = {}): GatewayPayment => {
    const payment: GatewayPayment = {
      id: String(next++),
      reference,
      status: PaymentStatus.APPROVED,
      externalStatus: 'approved',
      externalStatusDetail: 'accredited',
      amount: '30000.00',
      currency: 'ARS',
      installments: 1,
      approvedAt: new Date(),
      ...patch,
    }
    payments.set(payment.id, payment)
    return payment
  }
  return { gateway, checkouts, pay, payments, state }
}

describe('Mercado Pago payments (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  const fake = fakeGateway()
  let variantId: number
  let productId: number
  let categoryId: number
  let adminId: number
  let adminCookie: string
  const cartIds: number[] = []
  const orderIds: number[] = []
  const contact = { name: 'Ana Pago', email: 'ana-pago@example.test', deliveryMethod: 'STORE_PICKUP' }
  const server = (): App => app.getHttpServer()
  let notificationId = Date.now()

  async function cart(): Promise<string> {
    const response = await request(server()).post('/cart/items').send({ variantId, quantity: 2 }).expect(200)
    const raw: unknown = response.headers['set-cookie']
    const cookie = (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0]
    const saved = await prisma.cart.findFirstOrThrow({ orderBy: { id: 'desc' }, select: { id: true } })
    cartIds.push(saved.id)
    return cookie
  }
  async function place(paymentMethod?: string): Promise<{ order: OrderResponseDto; accessToken: string }> {
    const cookie = await cart()
    const reviewed = (
      await request(server()).post('/cart/checkout/preview').set('Cookie', cookie).send(contact).expect(200)
    ).body as CheckoutResponseDto
    const accessToken = randomBytes(32).toString('hex')
    const response = await request(server())
      .post('/cart/checkout/orders')
      .set('Cookie', cookie)
      .send({ ...contact, accessToken, reviewToken: reviewed.reviewToken, ...(paymentMethod ? { paymentMethod } : {}) })
      .expect(200)
    const order = response.body as OrderResponseDto
    orderIds.push(order.id)
    return { order, accessToken }
  }
  const pay = (number: string, accessToken: string): request.Test =>
    request(server()).post(`/orders/${number}/mercado-pago`).send({ accessToken })
  const refresh = async (number: string, accessToken: string): Promise<OrderResponseDto> =>
    (await request(server()).post(`/orders/${number}/mercado-pago/refresh`).send({ accessToken }).expect(200))
      .body as OrderResponseDto
  const notify = (paymentId: string, id = notificationId++, signature = SIGNATURE): request.Test =>
    request(server())
      .post(`/payments/webhooks/mercado-pago?data.id=${paymentId}&type=payment`)
      .set('x-signature', signature)
      .set('x-request-id', randomUUID())
      .send({ id, type: 'payment', action: 'payment.updated', data: { id: paymentId } })
  const stock = () => prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } })
  const admin = async (id: number): Promise<OrderResponseDto> =>
    (await request(server()).get(`/admin/orders/${id}`).set('Cookie', adminCookie).expect(200)).body as OrderResponseDto

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(fake.gateway)
      .compile()
    app = fixture.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)
    const suffix = randomUUID().slice(0, 8)
    const priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    adminId = (
      await prisma.user.create({
        data: {
          email: `payments-admin-${suffix}@example.test`,
          firstName: 'Payments',
          lastName: 'Test',
          role: UserRole.ADMIN,
          passwordHash: await hash(randomUUID(), 10),
        },
      })
    ).id
    adminCookie = `cg_at=${await app.get(JwtService).signAsync({ sub: adminId })}`
    categoryId = (await prisma.category.create({ data: { name: 'Payments test', slug: `payments-test-${suffix}` } })).id
    productId = (
      await prisma.product.create({
        data: { name: 'Payments test ink', slug: `payments-ink-${suffix}`, categoryId, status: 'PUBLISHED' },
      })
    ).id
    variantId = (
      await prisma.productVariant.create({
        data: {
          productId,
          sku: `PAY-${suffix}`,
          isDefault: true,
          weightGrams: 150,
          lengthMm: 60,
          widthMm: 60,
          heightMm: 150,
          inventory: { create: { onHand: 50 } },
          prices: { create: { priceListId, amount: '15000.00', currency: 'ARS' } },
        },
      })
    ).id
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
      await prisma.productVariant.update({ where: { id: variantId }, data: { deletedAt: now } })
      await prisma.product.update({ where: { id: productId }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.update({ where: { id: adminId }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('offers Mercado Pago with its own reservation window and creates a checkout for the order total', async () => {
    const cookie = await cart()
    const checkout = (await request(server()).get('/cart/checkout').set('Cookie', cookie).expect(200))
      .body as CheckoutResponseDto
    expect(checkout.paymentOptions).toEqual([
      { method: 'MANUAL', reservationMinutes: checkout.reservationHours * 60 },
      { method: 'MERCADO_PAGO', reservationMinutes: 60 },
    ])

    const { order, accessToken } = await place('MERCADO_PAGO')
    expect(order).toMatchObject({ paymentMethod: 'MERCADO_PAGO', status: 'PENDING_PAYMENT', payment: null })
    const minutes = (Date.parse(order.expiresAt!) - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(58)
    expect(minutes).toBeLessThanOrEqual(60)

    await pay(order.number, randomBytes(32).toString('hex')).expect(404)
    const started = await pay(order.number, accessToken).expect(200)
    expect(started.body).toEqual({ checkoutUrl: expect.stringMatching(/^https:\/\/mercadopago\.example\//) as unknown })
    const sent = fake.checkouts.at(-1)!
    expect(sent).toMatchObject({
      reference: order.number,
      lines: [{ quantity: 2, unitPrice: '15000.00' }],
      payer: { name: 'Ana Pago', email: 'ana-pago@example.test' },
      returnUrl: expect.stringMatching(new RegExp(`/pedidos/${order.number}/pago$`)) as unknown,
    })
    expect(sent.expiresAt.getTime()).toBe(Date.parse(order.expiresAt!) - 10 * 60_000)
  })

  it('confirms the order from a signed notification, once, and records what Mercado Pago reported', async () => {
    const { order, accessToken } = await place('MERCADO_PAGO')
    const before = await stock()
    const rejected = fake.pay(order.number, { status: PaymentStatus.REJECTED, externalStatus: 'rejected' })
    await notify(rejected.id, notificationId++, 'forged').expect(401)
    await notify(rejected.id).expect(200)
    let tracked = await refresh(order.number, accessToken)
    expect(tracked).toMatchObject({
      status: 'PENDING_PAYMENT',
      payment: { provider: 'MERCADO_PAGO', status: 'REJECTED' },
    })

    const approved = fake.pay(order.number)
    const id = notificationId++
    await notify(approved.id, id).expect(200)
    await notify(approved.id, id).expect(200)
    await notify(approved.id).expect(200)
    tracked = await refresh(order.number, accessToken)
    expect(tracked).toMatchObject({ status: 'CONFIRMED', payment: { status: 'APPROVED' } })
    expect(tracked.history.filter(event => event.status === 'CONFIRMED')).toHaveLength(1)
    const after = await stock()
    expect([after.onHand, after.reserved]).toEqual([before.onHand - 2, before.reserved - 2])
    const staff = await admin(order.id)
    expect(staff.payments?.map(payment => [payment.externalId, payment.status])).toEqual([
      [approved.id, 'APPROVED'],
      [rejected.id, 'REJECTED'],
    ])
    expect(staff.refundNeeded).toBe(false)
    expect(staff.history.at(-1)?.note).toBe(`Pago aprobado en Mercado Pago (operación ${approved.id})`)
    const notification = await prisma.paymentNotification.findUniqueOrThrow({
      where: { provider_externalId: { provider: 'MERCADO_PAGO', externalId: String(id) } },
    })
    expect(notification).toMatchObject({ status: 'PROCESSED', topic: 'payment', resourceId: approved.id })

    await pay(order.number, accessToken).expect(422)
  })

  it('confirms when the buyer comes back, reading Mercado Pago rather than the redirect', async () => {
    const { order, accessToken } = await place('MERCADO_PAGO')
    expect((await refresh(order.number, accessToken)).status).toBe('PENDING_PAYMENT')
    fake.pay(order.number)
    expect(await refresh(order.number, accessToken)).toMatchObject({
      status: 'CONFIRMED',
      payment: { status: 'APPROVED' },
    })
  })

  it('never pays twice: an approval not notified yet is found before a new checkout', async () => {
    const { order, accessToken } = await place('MERCADO_PAGO')
    fake.pay(order.number)
    const count = fake.checkouts.length
    await pay(order.number, accessToken).expect(422)
    expect(fake.checkouts).toHaveLength(count)
    expect((await refresh(order.number, accessToken)).status).toBe('CONFIRMED')
  })

  it('keeps late or partial payments off the order and flags them for a refund', async () => {
    const late = await place('MERCADO_PAGO')
    await prisma.order.update({ where: { id: late.order.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await pay(late.order.number, late.accessToken).expect(422)
    await app.get(OrderStatusService).change(late.order.id, { status: OrderStatus.EXPIRED })
    await notify(fake.pay(late.order.number).id).expect(200)
    expect((await refresh(late.order.number, late.accessToken)).status).toBe('EXPIRED')
    expect((await admin(late.order.id)).refundNeeded).toBe(true)

    const partial = await place('MERCADO_PAGO')
    await notify(fake.pay(partial.order.number, { amount: '100.00' }).id).expect(200)
    const staff = await admin(partial.order.id)
    expect(staff).toMatchObject({ status: 'PENDING_PAYMENT', refundNeeded: true })
  })

  it('answers 503 while Mercado Pago is down and processes the same notification when it is sent again', async () => {
    const { order, accessToken } = await place('MERCADO_PAGO')
    const payment = fake.pay(order.number)
    const id = notificationId++
    fake.state.down = true
    try {
      await notify(payment.id, id).expect(503)
    } finally {
      fake.state.down = false
    }
    expect(
      (
        await prisma.paymentNotification.findUniqueOrThrow({
          where: { provider_externalId: { provider: 'MERCADO_PAGO', externalId: String(id) } },
        })
      ).status,
    ).toBe('FAILED')
    await notify(payment.id, id).expect(200)
    expect((await refresh(order.number, accessToken)).status).toBe('CONFIRMED')
  })

  it('ignores payments that are not for one of our Mercado Pago orders', async () => {
    await notify(fake.pay('CG-999999999').id).expect(200)
    await notify('123456').expect(200)
    const manual = await place()
    expect(manual.order.paymentMethod).toBe('MANUAL')
    await pay(manual.order.number, manual.accessToken).expect(422)
    await notify(fake.pay(manual.order.number).id).expect(200)
    expect((await refresh(manual.order.number, manual.accessToken)).status).toBe('PENDING_PAYMENT')
  })
})
