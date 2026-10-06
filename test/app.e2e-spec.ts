import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from './../src/app.module'

// Requires a running MySQL (`npm run db:up`) and a valid DATABASE_URL in .env.
describe('AppController (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    // Bind 127.0.0.1 explicitly: supertest connects there, and an unbound app would get a port that another local
    // process may already hold on 127.0.0.1 (random 401s from that process on macOS).
    await app.listen(0, '127.0.0.1')
  })

  it('/health (GET)', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok', database: 'up' })
  })

  afterEach(async () => {
    await app.close()
  })
})
