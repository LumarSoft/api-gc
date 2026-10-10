import { createHmac } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { PaymentStatus } from '../generated/prisma/enums'
import { MercadoPagoClient } from './mercado-pago.client'
import { MercadoPagoGateway } from './mercado-pago.gateway'
import type { CheckoutRequest } from './payment-gateway'

const secret = 'webhook-secret'
const full = {
  MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-123',
  MERCADO_PAGO_WEBHOOK_SECRET: secret,
  MERCADO_PAGO_REFERENCE_PREFIX: 'DEV-',
  MERCADO_PAGO_NOTIFICATION_URL: 'https://api.example.test/payments/webhooks/mercado-pago',
}
const gateway = (env: Record<string, string> = full): MercadoPagoGateway => {
  const config = new ConfigService(env)
  return new MercadoPagoGateway(new MercadoPagoClient(config), config)
}
function withClient(request: jest.Mock, env: Record<string, string> = full): MercadoPagoGateway {
  const client = { request, hasCredentials: true, usesTestToken: env.MERCADO_PAGO_ACCESS_TOKEN.startsWith('TEST-') }
  return new MercadoPagoGateway(client as unknown as MercadoPagoClient, new ConfigService(env))
}
const sign = (manifest: string, key = secret): string => createHmac('sha256', key).update(manifest).digest('hex')

describe('Mercado Pago notifications', () => {
  const body = { id: 12345, type: 'payment', action: 'payment.updated', data: { id: '999001' } }
  const signed = (ts = '1704908010', requestId = 'req-1') => ({
    signature: `ts=${ts},v1=${sign(`id:999001;request-id:${requestId};ts:${ts};`)}`,
    requestId,
    query: 'data.id=999001&type=payment',
    body,
  })

  it('accepts a signed payment notification and reads its ids', () => {
    expect(gateway().readNotification(signed())).toEqual({
      notificationId: '12345',
      topic: 'payment',
      paymentId: '999001',
    })
  })

  it('refuses a wrong, missing or tampered signature', () => {
    const request = signed()
    expect(gateway().readNotification({ ...request, signature: undefined })).toBe('UNAUTHORIZED')
    expect(gateway().readNotification({ ...request, signature: 'ts=1704908010,v1=abc' })).toBe('UNAUTHORIZED')
    expect(gateway().readNotification({ ...request, query: 'data.id=999002&type=payment' })).toBe('UNAUTHORIZED')
    expect(gateway().readNotification({ ...request, requestId: 'req-2' })).toBe('UNAUTHORIZED')
    expect(gateway({ ...full, MERCADO_PAGO_WEBHOOK_SECRET: '' }).readNotification(request)).toBe('UNAUTHORIZED')
  })

  it('signs without the parts the request does not carry, and lowercases alphanumeric ids', () => {
    const ts = '1704908010'
    expect(
      gateway().readNotification({
        signature: `v1=${sign(`id:999001;ts:${ts};`)}, ts=${ts}`,
        requestId: undefined,
        query: 'data.id=999001&type=payment',
        body,
      }),
    ).toEqual({ notificationId: '12345', topic: 'payment', paymentId: '999001' })
    expect(
      gateway().readNotification({
        signature: `ts=${ts},v1=${sign(`id:abc123;request-id:r;ts:${ts};`)}`,
        requestId: 'r',
        query: 'data.id=ABC123&type=merchant_order',
        body: { id: 1, type: 'merchant_order' },
      }),
    ).toBe('IGNORED')
  })

  it('ignores other topics', () => {
    const ts = '1'
    const request = {
      signature: `ts=${ts},v1=${sign(`id:55;request-id:r;ts:${ts};`)}`,
      requestId: 'r',
      query: 'data.id=55&type=merchant_order',
      body: { id: 7, type: 'merchant_order', data: { id: '55' } },
    }
    expect(gateway().readNotification(request)).toBe('IGNORED')
  })
})

describe('Mercado Pago gateway requests', () => {
  const checkout: CheckoutRequest = {
    reference: 'CG-000123',
    lines: [{ id: 'T544', title: 'Tinta', quantity: 2, unitPrice: '15000.50' }],
    payer: { name: 'Ana', email: 'ana@example.test' },
    returnUrl: 'https://tienda.example.test/pedidos/CG-000123/pago',
    expiresAt: new Date('2026-10-10T13:00:00Z'),
  }

  it('is configured only with an access token', () => {
    expect(gateway().configured).toBe(true)
    expect(gateway({ ...full, MERCADO_PAGO_ACCESS_TOKEN: '' }).configured).toBe(false)
  })

  it('creates a binary, expiring preference with our amounts and prefixed reference', async () => {
    const request = jest.fn().mockResolvedValue({ id: 'pref', init_point: 'https://mp.example/checkout' })
    await expect(withClient(request).createCheckout(checkout)).resolves.toBe('https://mp.example/checkout')
    const [method, path, body] = request.mock.calls[0] as [string, string, Record<string, unknown>]
    expect([method, path]).toEqual(['POST', '/checkout/preferences'])
    expect(body).toMatchObject({
      items: [{ id: 'T544', title: 'Tinta', quantity: 2, unit_price: 15000.5, currency_id: 'ARS' }],
      payer: { name: 'Ana', email: 'ana@example.test' },
      external_reference: 'DEV-CG-000123',
      auto_return: 'approved',
      notification_url: `${full.MERCADO_PAGO_NOTIFICATION_URL}?source_news=webhooks`,
      binary_mode: true,
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      expires: true,
      expiration_date_to: '2026-10-10T13:00:00.000Z',
    })
  })

  it('leaves auto return out for http return URLs and uses the sandbox URL with TEST- tokens', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ init_point: 'https://mp.example/live', sandbox_init_point: 'https://mp.example/sandbox' })
    const test = withClient(request, { ...full, MERCADO_PAGO_ACCESS_TOKEN: 'TEST-1' })
    await expect(test.createCheckout({ ...checkout, returnUrl: 'http://localhost:3000/x' })).resolves.toBe(
      'https://mp.example/sandbox',
    )
    expect((request.mock.calls[0] as unknown[])[2]).not.toHaveProperty('auto_return')
  })

  it('asks for signed webhooks only, keeping a query the notification URL already has', async () => {
    const request = jest.fn().mockResolvedValue({ init_point: 'https://mp.example/live' })
    const env = { ...full, MERCADO_PAGO_NOTIFICATION_URL: 'https://api.example.test/hook?env=staging' }
    await withClient(request, env).createCheckout(checkout)
    expect((request.mock.calls[0] as Record<string, unknown>[])[2].notification_url).toBe(
      'https://api.example.test/hook?env=staging&source_news=webhooks',
    )
  })

  it('maps payments and keeps only our references', async () => {
    const payment = {
      id: 999001,
      status: 'approved',
      status_detail: 'accredited',
      external_reference: 'DEV-CG-000123',
      transaction_amount: 42143,
      currency_id: 'ARS',
      installments: 3,
      date_approved: '2026-10-10T12:30:00.000-03:00',
    }
    const request = jest.fn().mockResolvedValue({
      results: [payment, { ...payment, id: 2, external_reference: 'OTHER-CG-000123' }, { id: 3 }],
    })
    const found = await withClient(request).findPayments('CG-000123')
    expect((request.mock.calls[0] as string[])[1]).toContain('external_reference=DEV-CG-000123')
    expect(found).toEqual([
      {
        id: '999001',
        reference: 'CG-000123',
        status: PaymentStatus.APPROVED,
        externalStatus: 'approved',
        externalStatusDetail: 'accredited',
        amount: '42143.00',
        currency: 'ARS',
        installments: 3,
        approvedAt: new Date('2026-10-10T15:30:00.000Z'),
      },
    ])
  })

  it('never puts anything but a numeric id in the payment URL', async () => {
    const request = jest.fn()
    await expect(withClient(request).getPayment('1/../x')).rejects.toMatchObject({ kind: 'NOT_FOUND' })
    expect(request).not.toHaveBeenCalled()
  })
})
