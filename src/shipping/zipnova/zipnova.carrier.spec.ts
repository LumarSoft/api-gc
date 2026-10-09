import { ConfigService } from '@nestjs/config'
import { CarrierError } from '../shipping-carrier'
import { ZipnovaCarrier } from './zipnova.carrier'
import { ZipnovaClient, type ZipnovaDownload } from './zipnova.client'

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

describe('Zipnova carrier requests', () => {
  const shipment = (id: number, status: string) => ({ id, external_id: 'DEV-CG-000001', status, status_name: status })
  function withClient(client: Partial<ZipnovaClient>, env: Record<string, string> = full): ZipnovaCarrier {
    return new ZipnovaCarrier(client as ZipnovaClient, new ConfigService(env))
  }

  it('prefixes references and only recovers live bookings', async () => {
    const paths: string[] = []
    const request = jest.fn((_method: string, path: string) => {
      paths.push(path)
      return Promise.resolve(
        path.startsWith('/shipments?') ? { data: [shipment(1, 'cancelled'), shipment(2, 'new')] } : shipment(2, 'new'),
      )
    })
    const zipnova = withClient({ request } as Partial<ZipnovaClient>, { ...full, ZIPNOVA_REFERENCE_PREFIX: 'DEV-' })
    expect(await zipnova.findShipment('CG-000001')).toMatchObject({ id: '2' })
    expect(paths[0]).toContain('external_id=DEV-CG-000001')
    expect(paths[1]).toBe('/shipments/2')
  })

  it('reads "not cancellable now" as a refusal, not as Zipnova being down', async () => {
    const request = jest.fn(() => Promise.reject(new CarrierError('UNAVAILABLE', 'Zipnova answered 401', 401)))
    await expect(withClient({ request }).cancelShipment('2')).rejects.toMatchObject({
      kind: 'REJECTED',
    })
  })

  it('accepts documents as a raw file or as base64 in `body`, as Zipnova answers them', async () => {
    const download = (answer: ZipnovaDownload) => withClient({ download: () => Promise.resolve(answer) })
    const raw = await download({ bytes: Buffer.from('%PDF'), contentType: 'application/pdf' }).document(
      '2',
      'label',
      'pdf',
    )
    expect(raw.content.toString()).toBe('%PDF')
    const json = await download({ json: { format: 'zpl', body: Buffer.from('^XA').toString('base64') } }).document(
      '2',
      'label',
      'zpl',
    )
    expect(json).toMatchObject({ contentType: 'text/plain; charset=utf-8', fileName: 'etiqueta-2.zpl' })
    expect(json.content.toString()).toBe('^XA')
    const plain = await download({ json: { format: 'zpl', body: '^XA^FO50^XZ' } }).document('2', 'label', 'zpl')
    expect(plain.content.toString()).toBe('^XA^FO50^XZ')
    await expect(download({ json: {} }).document('2', 'label', 'pdf')).rejects.toMatchObject({ kind: 'NOT_READY' })
  })

  it('explains a missing dispatch guide instead of passing on the provider message', async () => {
    const download = () => Promise.reject(new CarrierError('REJECTED', 'Shipment does not use shipping guide.', 400))
    await expect(withClient({ download }).document('2', 'guide', 'pdf')).rejects.toMatchObject({
      kind: 'REJECTED',
      message: 'este transporte no usa guía de despacho; alcanza con la etiqueta',
    })
  })

  it('never puts a non-numeric id in a provider URL', async () => {
    await expect(withClient({}).getShipment('../accounts')).rejects.toMatchObject({ kind: 'NOT_FOUND' })
  })
})
