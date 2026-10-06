import { INestApplication, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import { AppModule } from '../src/app.module'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'
import type {
  AdminWholesaleApplicationDto,
  MyWholesaleApplicationDto,
  WholesaleApplicationsPageDto,
} from '../src/wholesale-applications/dto/wholesale-application-response.dto'
import { isValidCuit } from '../src/wholesale-applications/lib/cuit'

/** A random company CUIT with a valid check digit, so repeated runs never collide on the unique column. */
function randomCuit(): string {
  for (;;) {
    const cuit = `30${String(randomInt(0, 100_000_000)).padStart(8, '0')}`
    for (let digit = 0; digit <= 9; digit++) if (isValidCuit(cuit + digit)) return cuit + digit
  }
}

describe('Wholesale applications (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  const userIds: number[] = []
  let customerCookie: string
  let otherCookie: string
  let adminCookie: string
  let customerId: number
  const cuit = randomCuit()
  const server = (): App => app.getHttpServer()
  const input = {
    legalName: 'Imprenta de Prueba SRL',
    cuit: `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit[10]}`,
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'compras@example.test',
    message: 'Compramos tintas todos los meses.',
  }
  const mine = async (cookie = customerCookie): Promise<MyWholesaleApplicationDto> =>
    (await request(server()).get('/wholesale-applications/mine').set('Cookie', cookie).expect(200))
      .body as MyWholesaleApplicationDto
  const buyerType = async (): Promise<string> =>
    ((await request(server()).get('/auth/me').set('Cookie', customerCookie).expect(200)).body as { buyerType: string })
      .buyerType
  const decide = (id: number, decision: string, note?: string): request.Test =>
    request(server())
      .post(`/admin/wholesale-applications/${id}/${decision}`)
      .set('Cookie', adminCookie)
      .send(note ? { note } : {})

  async function user(prefix: string, role: UserRole = UserRole.CUSTOMER): Promise<[number, string]> {
    const created = await prisma.user.create({
      data: {
        email: `${prefix}-${randomUUID().slice(0, 8)}@example.test`,
        firstName: 'Wholesale',
        lastName: 'Test',
        role,
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    userIds.push(created.id)
    return [created.id, `cg_at=${await app.get(JwtService).signAsync({ sub: created.id })}`]
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
    ;[customerId, customerCookie] = await user('wholesale-customer')
    ;[, otherCookie] = await user('wholesale-other')
    ;[, adminCookie] = await user('wholesale-admin', UserRole.ADMIN)
  })

  afterAll(async () => {
    if (prisma) {
      const companies = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { companyId: true } })
      const companyIds = companies.flatMap(row => (row.companyId ? [row.companyId] : []))
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { companyId: null, deletedAt: new Date() } })
      await prisma.wholesaleApplication.deleteMany({ where: { companyId: { in: companyIds } } })
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } })
    }
    if (app) await app.close()
  })

  it('validates the application and blocks a second one while it is pending', async () => {
    expect(await mine()).toEqual({ application: null, canApply: true, blockReason: null })
    await request(server()).post('/wholesale-applications').send(input).expect(401)
    await request(server())
      .post('/wholesale-applications')
      .set('Cookie', customerCookie)
      .send({ ...input, cuit: '30-12345678-0' })
      .expect(422)
    await request(server())
      .post('/wholesale-applications')
      .set('Cookie', customerCookie)
      .send({ ...input, taxCondition: 'CONSUMIDOR_FINAL' })
      .expect(400)

    const created = (
      await request(server()).post('/wholesale-applications').set('Cookie', customerCookie).send(input).expect(201)
    ).body as MyWholesaleApplicationDto
    expect(created.application?.status).toBe('PENDING')
    expect(created.application?.company.cuit).toBe(cuit)
    expect(created.canApply).toBe(false)
    await request(server()).post('/wholesale-applications').set('Cookie', customerCookie).send(input).expect(409)
    await request(server()).post('/wholesale-applications').set('Cookie', otherCookie).send(input).expect(409)
    expect(await buyerType()).toBe('RETAIL')
  })

  it('lets staff reject with a reason, and the customer re-apply', async () => {
    await request(server()).get('/admin/wholesale-applications').set('Cookie', customerCookie).expect(403)
    const first = (await mine()).application!.id
    const page = (
      await request(server()).get('/admin/wholesale-applications?status=PENDING').set('Cookie', adminCookie).expect(200)
    ).body as WholesaleApplicationsPageDto
    const listed = page.items.find(item => item.id === first)!
    expect(listed.allowedDecisions).toEqual(['approve', 'reject'])
    expect(listed.submittedBy.email).toMatch(/^wholesale-customer-/)

    await decide(first, 'reject').expect(422)
    await decide(first, 'reject', 'Falta la constancia de inscripción.').expect(200)
    const rejected = await mine()
    expect(rejected.application?.status).toBe('REJECTED')
    expect(rejected.application?.reviewNote).toBe('Falta la constancia de inscripción.')
    expect(rejected.canApply).toBe(true)
    expect(await prisma.emailMessage.count({ where: { template: 'wholesale-rejected', relatedId: customerId } })).toBe(
      1,
    )

    await request(server())
      .post('/wholesale-applications')
      .set('Cookie', customerCookie)
      .send({ ...input, tradeName: 'Imprenta Prueba' })
      .expect(201)
    const old = (await decide(first, 'approve').expect(422)).body as { message: string }
    expect(old.message).toMatch(/ya no admite/)
  })

  it('approves, pauses and resumes the account, changing the buyer profile immediately', async () => {
    const latest = (await mine()).application!.id
    const approved = (await decide(latest, 'approve').expect(200)).body as AdminWholesaleApplicationDto
    expect(approved.company.wholesaleStatus).toBe('APPROVED')
    expect(approved.allowedDecisions).toEqual(['pause'])
    expect(await buyerType()).toBe('WHOLESALE')
    expect((await mine()).blockReason).toMatch(/aprobada/)

    await decide(latest, 'pause').expect(422)
    await decide(latest, 'pause', 'Cuenta en revisión por el equipo.').expect(200)
    expect(await buyerType()).toBe('RETAIL')
    expect((await mine()).canApply).toBe(false)
    await decide(latest, 'resume').expect(200)
    expect(await buyerType()).toBe('WHOLESALE')
    expect(await prisma.auditLog.count({ where: { entityType: 'WholesaleApplication', entityId: latest } })).toBe(3)
  })
})
