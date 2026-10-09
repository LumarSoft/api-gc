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
import { hashToken } from '../src/common/utils/secure-token'
import { BuyerType, OrderStatus, ShipmentStatus, UserRole } from '../src/generated/prisma/enums'
import type { OrderResponseDto } from '../src/orders/dto/order-response.dto'
import { OrderStatusService } from '../src/orders/order-status.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { ShippingQuotesResponseDto } from '../src/shipping/dto/shipping-quote-response.dto'
import {
  SHIPPING_CARRIER,
  type CarrierShipment,
  type CarrierShipmentRequest,
  type ShippingCarrier,
} from '../src/shipping/shipping-carrier'

const TOKEN = 'w'.repeat(40)

/** Stands in for Zipnova: the suite checks our flow, never the provider. */
function fakeCarrier() {
  const remote = new Map<string, { reference: string; status: ShipmentStatus; label: string }>()
  const booked: CarrierShipmentRequest[] = []
  // Unique per run: the e2e database keeps the shipments of earlier runs and `externalId` is unique.
  let next = Date.now()
  const view = (id: string): CarrierShipment => {
    const shipment = remote.get(id)!
    return {
      id,
      reference: shipment.reference,
      status: shipment.status,
      statusLabel: shipment.label,
      carrier: 'OCA',
      trackingNumber: '4000123',
      trackingUrl: 'https://tracking.example/4000123',
    }
  }
  const carrier: ShippingCarrier = {
    configured: true,
    quote: () =>
      Promise.resolve([
        {
          carrierId: 208,
          carrier: 'OCA',
          serviceType: 'standard_delivery',
          service: 'Entrega a domicilio',
          logisticType: 'carrier_dropoff',
          price: '12143.00',
          cost: '11800.00',
          minDays: 4,
          maxDays: 5,
          pickupPoints: [],
        },
        {
          carrierId: 233,
          carrier: 'Correo Argentino',
          serviceType: 'pickup_point',
          service: 'Entrega en sucursal',
          logisticType: 'carrier_dropoff',
          price: '12062.00',
          cost: '12062.00',
          minDays: 4,
          maxDays: 5,
          pickupPoints: [
            { id: 11, description: 'Sucursal Centro — Mitre 1, Córdoba' },
            { id: 12, description: 'Sucursal Norte — Colón 900, Córdoba' },
          ],
        },
      ]),
    createShipment: shipment => {
      booked.push(shipment)
      const id = String(next++)
      remote.set(id, { reference: shipment.reference, status: ShipmentStatus.PENDING, label: 'Procesando' })
      return Promise.resolve(view(id))
    },
    findShipment: reference => {
      const found = [...remote.entries()].find(([, shipment]) => shipment.reference === reference)
      return Promise.resolve(found ? view(found[0]) : null)
    },
    getShipment: id => Promise.resolve(view(id)),
    cancelShipment: id => {
      remote.set(id, { ...remote.get(id)!, status: ShipmentStatus.CANCELLED, label: 'Anulación Confirmada' })
      return Promise.resolve('CANCELLED')
    },
    document: (_id, kind, format) =>
      Promise.resolve({
        content: Buffer.from(format === 'zpl' ? '^XA^XZ' : '%PDF-1.7'),
        contentType: format === 'zpl' ? 'text/plain; charset=utf-8' : 'application/pdf',
        fileName: `${kind}.${format}`,
      }),
    readNotification: (token, body) => {
      if (token !== TOKEN) return 'UNAUTHORIZED'
      const id = (body as { data?: { shipment_id?: number } }).data?.shipment_id
      return id ? { shipmentId: String(id) } : 'IGNORED'
    },
  }
  const move = (id: string, status: ShipmentStatus, label: string): void => {
    remote.set(id, { ...remote.get(id)!, status, label })
  }
  return { carrier, booked, move }
}

describe('Carrier shipping (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  const fake = fakeCarrier()
  let variantId: number
  let productId: number
  let categoryId: number
  let adminId: number
  let adminCookie: string
  const cartIds: number[] = []
  const orderIds: number[] = []
  const destination = { postalCode: '5000', city: 'Córdoba', province: 'Córdoba' }
  const address = { street: 'Mitre', streetNumber: '1', ...destination, taxId: '30.111.222' }
  const contact = { name: 'Ana Envío', email: 'ana-envio@example.test', phone: '3415550000' }
  const server = (): App => app.getHttpServer()

  async function cart(): Promise<string> {
    const response = await request(server()).post('/cart/items').send({ variantId, quantity: 2 }).expect(200)
    const raw: unknown = response.headers['set-cookie']
    const cookie = (Array.isArray(raw) ? String(raw[0]) : String(raw)).split(';')[0]
    const saved = await prisma.cart.findUniqueOrThrow({
      where: { guestToken: hashToken(cookie.split('=')[1]) },
      select: { id: true },
    })
    cartIds.push(saved.id)
    return cookie
  }
  async function quote(cookie: string): Promise<ShippingQuotesResponseDto> {
    const response = await request(server())
      .post('/cart/checkout/shipping-quotes')
      .set('Cookie', cookie)
      .send({ destination })
      .expect(200)
    return response.body as ShippingQuotesResponseDto
  }
  function preview(cookie: string, shippingQuoteId: number, patch: object = {}): request.Test {
    return request(server())
      .post('/cart/checkout/preview')
      .set('Cookie', cookie)
      .send({ ...contact, deliveryMethod: 'CARRIER', shippingAddress: address, shippingQuoteId, ...patch })
  }
  async function place(cookie: string, shippingQuoteId: number): Promise<OrderResponseDto> {
    const reviewed = (await preview(cookie, shippingQuoteId).expect(200)).body as CheckoutResponseDto
    const response = await request(server())
      .post('/cart/checkout/orders')
      .set('Cookie', cookie)
      .send({
        ...contact,
        deliveryMethod: 'CARRIER',
        shippingAddress: address,
        shippingQuoteId,
        accessToken: randomBytes(32).toString('hex'),
        reviewToken: reviewed.reviewToken,
      })
      .expect(200)
    const order = response.body as OrderResponseDto
    orderIds.push(order.id)
    return order
  }
  async function paidOrder(): Promise<OrderResponseDto> {
    const cookie = await cart()
    const order = await place(cookie, (await quote(cookie)).options[0].id)
    await request(server())
      .put(`/admin/orders/${order.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: OrderStatus.CONFIRMED, paymentReceived: true })
      .expect(200)
    return order
  }
  const admin = (method: 'get' | 'post', path: string): request.Test =>
    request(server())[method](`/admin/orders/${path}`).set('Cookie', adminCookie)
  const notify = (token: string, shipmentId: string): request.Test =>
    request(server())
      .post(`/shipping/webhooks/${token}`)
      .send({ topic: 'status', timestamp: '2026-10-10T12:00:00+00:00', data: { shipment_id: Number(shipmentId) } })

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SHIPPING_CARRIER)
      .useValue(fake.carrier)
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
          email: `shipping-admin-${suffix}@example.test`,
          firstName: 'Shipping',
          lastName: 'Test',
          role: UserRole.ADMIN,
          passwordHash: await hash(randomUUID(), 10),
        },
      })
    ).id
    adminCookie = `cg_at=${await app.get(JwtService).signAsync({ sub: adminId })}`
    categoryId = (await prisma.category.create({ data: { name: 'Shipping test', slug: `shipping-test-${suffix}` } })).id
    productId = (
      await prisma.product.create({
        data: { name: 'Shipping test ink', slug: `shipping-ink-${suffix}`, categoryId, status: 'PUBLISHED' },
      })
    ).id
    variantId = (
      await prisma.productVariant.create({
        data: {
          productId,
          sku: `SHIP-${suffix}`,
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

  it('quotes a cart, prices the chosen option and keeps it tied to the cart and the destination', async () => {
    const cookie = await cart()
    const quotes = await quote(cookie)
    expect(quotes.options.map(option => [option.kind, option.carrier, option.cost.amount])).toEqual([
      ['HOME', 'OCA', '12143.00'],
      ['PICKUP_POINT', 'Correo Argentino', '12062.00'],
      ['PICKUP_POINT', 'Correo Argentino', '12062.00'],
    ])
    const home = quotes.options[0].id
    const reviewed = (await preview(cookie, home).expect(200)).body as CheckoutResponseDto
    expect(reviewed.shippingTotal?.amount).toBe('12143.00')
    expect(reviewed.total?.amount).toBe('42143.00')
    expect(reviewed.shippingQuote).toMatchObject({ id: home, kind: 'HOME', carrier: 'OCA' })
    expect(reviewed.deliveryOptions.find(option => option.code === 'CARRIER')?.enabled).toBe(true)

    await preview(cookie, home, { shippingAddress: { ...address, postalCode: '5001' } }).expect(422)
    await preview(cookie, home, { shippingAddress: { ...address, taxId: undefined } }).expect(422)
    await preview(cookie, home, { phone: undefined }).expect(422)
    await preview(cookie, home, { shippingAddress: { ...address, taxId: '12' } }).expect(400)
    const other = await cart()
    await preview(other, home).expect(422)
    await request(server()).post('/cart/items').set('Cookie', cookie).send({ variantId, quantity: 1 }).expect(200)
    await preview(cookie, home).expect(422)
    const fresh = (await quote(cookie)).options[0].id
    await prisma.shippingQuote.update({ where: { id: fresh }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await preview(cookie, fresh).expect(422)
  })

  it('ships unmeasured or bulky carts by arrangement', async () => {
    const cookie = await cart()
    await prisma.productVariant.update({ where: { id: variantId }, data: { isBulky: true } })
    try {
      const checkout = (await request(server()).get('/cart/checkout').set('Cookie', cookie).expect(200))
        .body as CheckoutResponseDto
      expect(checkout.deliveryOptions.find(option => option.code === 'CARRIER')).toMatchObject({
        enabled: false,
        unavailableReason: expect.stringMatching(/a coordinar/) as unknown,
      })
      await request(server())
        .post('/cart/checkout/shipping-quotes')
        .set('Cookie', cookie)
        .send({ destination })
        .expect(422)
    } finally {
      await prisma.productVariant.update({ where: { id: variantId }, data: { isBulky: false } })
    }
  })

  it('places the order with the branch, books it once paid and follows the carrier to delivery', async () => {
    const cookie = await cart()
    const branch = (await quote(cookie)).options[2]
    const order = await place(cookie, branch.id)
    expect(order.shippingTotal.amount).toBe('12062.00')
    expect(order.shippingAddress).toMatchObject({ postalCode: '5000', city: 'Córdoba' })
    expect(order.shipment).toMatchObject({
      status: ShipmentStatus.PENDING,
      carrier: 'Correo Argentino',
      pickupPoint: 'Sucursal Norte — Colón 900, Córdoba',
    })
    const saved = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id } })
    expect(saved).toMatchObject({ carrierId: 233, serviceType: 'pickup_point', pickupPointId: 12, externalId: null })
    expect((await prisma.orderAddress.findFirstOrThrow({ where: { orderId: order.id, type: 'SHIPPING' } })).taxId).toBe(
      '30111222',
    )

    expect(((await admin('get', `${order.id}`).expect(200)).body as OrderResponseDto).shipment?.actions).toEqual([])
    await admin('post', `${order.id}/shipment`).expect(422)
    await request(server())
      .put(`/admin/orders/${order.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: OrderStatus.CONFIRMED, paymentReceived: true })
      .expect(200)
    await request(server()).post(`/admin/orders/${order.id}/shipment`).expect(401)

    const booked = (await admin('post', `${order.id}/shipment`).expect(200)).body as OrderResponseDto
    expect(booked.shipment?.actions).toEqual(['DOCUMENTS', 'CANCEL', 'REFRESH'])
    expect(fake.booked.at(-1)).toMatchObject({
      reference: order.number,
      carrierId: 233,
      pickupPointId: 12,
      declaredValue: '30000.00',
      recipient: { taxId: '30111222', phone: '3415550000' },
    })
    expect(fake.booked.at(-1)?.items).toHaveLength(2)
    await admin('post', `${order.id}/shipment`).expect(422)
    const externalId = (await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id } })).externalId!

    const label = await admin('get', `${order.id}/shipment/documents/label?format=zpl`).expect(200)
    expect(label.headers['content-type']).toMatch(/^text\/plain/)
    expect(label.headers['content-disposition']).toBe('attachment; filename="label.zpl"')
    await admin('get', `${order.id}/shipment/documents/guide?format=zpl`).expect(400)
    await admin('get', `${order.id}/shipment/documents/receipt`).expect(400)

    await notify('x'.repeat(40), externalId).expect(404)
    fake.move(externalId, ShipmentStatus.READY_FOR_PICKUP, 'Listo para Retirar')
    await notify(TOKEN, externalId).expect(200)
    await notify(TOKEN, externalId).expect(200)
    let current = (await admin('get', `${order.id}`).expect(200)).body as OrderResponseDto
    expect(current.status).toBe(OrderStatus.SHIPPED)
    expect(current.shipment).toMatchObject({
      status: ShipmentStatus.READY_FOR_PICKUP,
      carrierStatus: 'Listo para Retirar',
      trackingNumber: '4000123',
      actions: ['DOCUMENTS', 'REFRESH'],
    })
    expect(current.history.filter(event => event.status === OrderStatus.SHIPPED)).toEqual([
      expect.objectContaining({ note: 'OCA: Listo para Retirar', by: null }),
    ])

    fake.move(externalId, ShipmentStatus.DELIVERED, 'Entregado')
    await notify(TOKEN, externalId).expect(200)
    current = (await admin('get', `${order.id}`).expect(200)).body as OrderResponseDto
    expect(current.status).toBe(OrderStatus.DELIVERED)
    const delivered = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id } })
    expect(delivered.shippedAt).not.toBeNull()
    expect(delivered.deliveredAt).not.toBeNull()
    await notify(TOKEN, '999999').expect(200)
  })

  it('cancels a booked shipment without moving the order, and books it again with a new reference', async () => {
    const order = await paidOrder()
    await admin('post', `${order.id}/shipment/cancel`).expect(422)
    await admin('post', `${order.id}/shipment`).expect(200)
    const cancelled = (await admin('post', `${order.id}/shipment/cancel`).expect(200)).body as OrderResponseDto
    expect(cancelled.status).toBe(OrderStatus.CONFIRMED)
    expect(cancelled.shipment).toMatchObject({ status: ShipmentStatus.CANCELLED, actions: ['CREATE', 'REFRESH'] })
    await admin('get', `${order.id}/shipment/documents/label`).expect(422)

    const again = (await admin('post', `${order.id}/shipment`).expect(200)).body as OrderResponseDto
    expect(again.shipment).toMatchObject({
      status: ShipmentStatus.PENDING,
      actions: ['DOCUMENTS', 'CANCEL', 'REFRESH'],
    })
    expect(fake.booked.at(-1)?.reference).toBe(`${order.number}-2`)
    const rows = await prisma.shipment.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } })
    expect(rows.map(row => [row.status, row.carrierId, row.bookingStartedAt])).toEqual([
      [ShipmentStatus.CANCELLED, 208, null],
      [ShipmentStatus.PENDING, 208, null],
    ])
  })

  it('books a shipment marked as shipped by hand, and never twice while a booking is in flight', async () => {
    const order = await paidOrder()
    for (const status of [OrderStatus.PREPARING, OrderStatus.SHIPPED])
      await request(server())
        .put(`/admin/orders/${order.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status })
        .expect(200)
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id } })
    await prisma.shipment.update({ where: { id: shipment.id }, data: { bookingStartedAt: new Date() } })
    const booked = fake.booked.length
    await admin('post', `${order.id}/shipment`).expect(409)
    expect(fake.booked).toHaveLength(booked)
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { bookingStartedAt: new Date(Date.now() - 3 * 60_000) },
    })
    expect(((await admin('post', `${order.id}/shipment`).expect(200)).body as OrderResponseDto).status).toBe(
      OrderStatus.SHIPPED,
    )
    expect(fake.booked).toHaveLength(booked + 1)
  })

  it('closes the shipment of an unpaid order that is cancelled', async () => {
    const cookie = await cart()
    const order = await place(cookie, (await quote(cookie)).options[0].id)
    const cancelled = (
      await request(server())
        .put(`/admin/orders/${order.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: OrderStatus.CANCELLED })
        .expect(200)
    ).body as OrderResponseDto
    expect(cancelled.shipment).toMatchObject({ status: ShipmentStatus.CANCELLED, actions: [] })
  })
})
