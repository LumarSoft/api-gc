import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from './../src/app.module'

// The global limit is 100 requests/min per IP. Every request in this file comes from the same IP, like the front's
// server rendering pages for many visitors. Requires a running MySQL and a valid .env (see app.e2e-spec.ts).
const OVER_THE_LIMIT = 110

async function statusCodes(app: INestApplication<App>, path: string): Promise<Set<number>> {
  const codes = new Set<number>()
  for (let i = 0; i < OVER_THE_LIMIT; i++) codes.add((await request(app.getHttpServer()).get(path)).status)
  return codes
}

describe('Rate limits (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    // Same request handling as main.ts: query params are transformed by the global pipe, cookies are parsed.
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    // Bind 127.0.0.1 explicitly: supertest connects there, and an unbound app would get a port that another local
    // process may already hold on 127.0.0.1 (random 401s from that process on macOS).
    await app.listen(0, '127.0.0.1')
  })

  afterEach(async () => {
    await app.close()
  })

  it.each(['/products', '/categories', '/tags', '/brands'])(
    'does not rate limit %s (rendered by the front server)',
    async path => {
      expect(await statusCodes(app, path)).toEqual(new Set([200]))
    },
  )

  it('does not rate limit GET /auth/me (read by the front server)', async () => {
    expect(await statusCodes(app, '/auth/me')).toEqual(new Set([401]))
  })

  it('still applies the global limit to other routes', async () => {
    expect(await statusCodes(app, '/health')).toContain(429)
  })
})
