import { ConfigService } from '@nestjs/config'
import { ZipnovaCarrier } from './zipnova.carrier'
import { ZipnovaClient } from './zipnova.client'

const secret = 'a'.repeat(64)
const carrier = (env: Record<string, string>): ZipnovaCarrier => {
  const config = new ConfigService(env)
  return new ZipnovaCarrier(new ZipnovaClient(config), config)
}
const full = {
  ZIPNOVA_API_KEY: 'key',
  ZIPNOVA_API_SECRET: 'secret',
  ZIPNOVA_ACCOUNT_ID: '11600',
  ZIPNOVA_ORIGIN_ID: '375310',
  ZIPNOVA_WEBHOOK_SECRET: secret,
}

describe('Zipnova carrier', () => {
  it('is configured only with credentials, account and origin', () => {
    expect(carrier(full).configured).toBe(true)
    expect(carrier({ ...full, ZIPNOVA_ORIGIN_ID: '' }).configured).toBe(false)
    expect(carrier({ ...full, ZIPNOVA_API_SECRET: '' }).configured).toBe(false)
  })

  it('accepts notifications only with the URL secret and reads the shipment id', () => {
    const zipnova = carrier(full)
    const body = { topic: 'status', data: { shipment_id: 3850099, status_code: 'delivered' } }
    expect(zipnova.readNotification(secret, body)).toEqual({ shipmentId: '3850099' })
    expect(zipnova.readNotification('b'.repeat(64), body)).toBe('UNAUTHORIZED')
    expect(zipnova.readNotification('short', body)).toBe('UNAUTHORIZED')
    expect(zipnova.readNotification(secret, { topic: 'account_balance', data: {} })).toBe('IGNORED')
    expect(zipnova.readNotification(secret, { topic: 'status', data: { shipment_id: '1; drop' } })).toBe('IGNORED')
    expect(zipnova.readNotification(secret, null)).toBe('IGNORED')
  })

  it('refuses every notification while the secret is missing or too short', () => {
    expect(carrier({ ...full, ZIPNOVA_WEBHOOK_SECRET: '' }).readNotification('', {})).toBe('UNAUTHORIZED')
    expect(carrier({ ...full, ZIPNOVA_WEBHOOK_SECRET: 'x' }).readNotification('x', {})).toBe('UNAUTHORIZED')
  })
})
