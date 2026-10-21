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
import type {
  AdminConversationDto,
  AdminConversationsPageDto,
  AssistantUsageDto,
  QuestionStatusResultDto,
  UnansweredQuestionCountsDto,
  UnansweredQuestionsPageDto,
} from '../src/assistant/dto/admin-assistant-response.dto'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { argentineDay } from '../src/common/utils/report-period'
import { hashToken } from '../src/common/utils/secure-token'
import { ConversationStatus, MessageRole, UserRole } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Admin assistant (local MySQL e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  const userIds: number[] = []
  const conversationIds: number[] = []
  const questionIds: number[] = []
  let productIds: number[] = []
  let categoryId: number
  let adminCookie: string
  let customerCookie: string
  let customerEmail: string
  /** Unique per run, so searches only find this suite's conversations. */
  const word = `consultaadmin${randomUUID().slice(0, 8)}`
  /** A day in the past that no other suite writes to, so its usage is exactly this suite's fixtures. */
  const pastYear = 2000 + randomInt(0, 20)
  const server = (): App => app.getHttpServer()
  const get = <T>(path: string, status = 200): Promise<T> =>
    request(server())
      .get(path)
      .set('Cookie', adminCookie)
      .expect(status)
      .then(response => response.body as T)
  const changeStatus = (ids: number[], status: string): request.Test =>
    request(server()).post('/admin/assistant/questions/status').set('Cookie', adminCookie).send({ ids, status })

  async function user(prefix: string, role: UserRole = UserRole.CUSTOMER): Promise<[number, string, string]> {
    const created = await prisma.user.create({
      data: {
        email: `${prefix}-${randomUUID().slice(0, 8)}@example.test`,
        firstName: 'Ana',
        lastName: 'Prueba',
        role,
        passwordHash: await hash(randomBytes(16).toString('hex'), 10),
      },
    })
    userIds.push(created.id)
    return [created.id, created.email, `cg_at=${await app.get(JwtService).signAsync({ sub: created.id })}`]
  }

  /** A stored conversation: messages in order, the last answer showing `shown` as cards. */
  async function conversation(
    data: { userId?: number; status?: ConversationStatus; escalationReason?: string; createdAt?: Date },
    messages: { role: MessageRole; content: string; shown?: number[]; tokens?: [number, number] }[],
  ): Promise<number> {
    const createdAt = data.createdAt ?? new Date()
    const created = await prisma.assistantConversation.create({
      data: {
        sessionId: hashToken(randomUUID()),
        userId: data.userId ?? null,
        status: data.status ?? ConversationStatus.OPEN,
        escalationReason: data.escalationReason ?? null,
        escalatedAt: data.status === ConversationStatus.ESCALATED ? createdAt : null,
        inputTokens: messages.reduce((total, message) => total + (message.tokens?.[0] ?? 0), 0),
        outputTokens: messages.reduce((total, message) => total + (message.tokens?.[1] ?? 0), 0),
        createdAt,
        lastMessageAt: createdAt,
      },
    })
    conversationIds.push(created.id)
    for (const [index, message] of messages.entries())
      await prisma.assistantMessage.create({
        data: {
          conversationId: created.id,
          role: message.role,
          content: message.content,
          model: message.role === MessageRole.ASSISTANT ? 'fake-model' : null,
          inputTokens: message.tokens?.[0] ?? null,
          outputTokens: message.tokens?.[1] ?? null,
          recommendedProducts: message.shown,
          createdAt: new Date(createdAt.getTime() + index * 1000),
        },
      })
    return created.id
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
    let customerId: number
    ;[customerId, customerEmail, customerCookie] = await user('assistant-customer')
    ;[, , adminCookie] = await user('assistant-admin', UserRole.ADMIN)

    const suffix = randomUUID().slice(0, 8)
    categoryId = (
      await prisma.category.create({ data: { name: 'Admin assistant', slug: `admin-assistant-${suffix}` } })
    ).id
    productIds = await Promise.all(
      ['visible', 'archivado'].map(async name => {
        const product = await prisma.product.create({
          data: { name: `Impresora ${name} ${suffix}`, slug: `admin-assistant-${suffix}-${name}`, categoryId },
          select: { id: true },
        })
        return product.id
      }),
    )
    await prisma.product.update({ where: { id: productIds[1] }, data: { deletedAt: new Date() } })

    // A guest who asked about printers, and a signed-in customer who was handed off to a person.
    await conversation({}, [
      { role: MessageRole.USER, content: `¿Qué impresora ${word} me conviene\n para fotos?` },
      { role: MessageRole.ASSISTANT, content: 'Te muestro dos.', shown: productIds, tokens: [900, 90] },
    ])
    const escalated = await conversation(
      {
        userId: customerId,
        status: ConversationStatus.ESCALATED,
        escalationReason: 'Pide hablar con una persona',
        createdAt: new Date(Date.now() - 60_000),
      },
      [
        { role: MessageRole.USER, content: `Quiero una cotización por mayor ${word}` },
        { role: MessageRole.ASSISTANT, content: 'Te paso con el equipo.', tokens: [500, 50] },
        { role: MessageRole.USER, content: '¿Y la dirección del local?' },
        { role: MessageRole.ASSISTANT, content: 'No la tengo cargada.', tokens: [600, 60] },
      ],
    )
    for (const question of [`¿Dónde queda el local? ${word}`, `¿Abren los sábados? ${word}`]) {
      const created = await prisma.unansweredQuestion.create({ data: { conversationId: escalated, question } })
      questionIds.push(created.id)
    }

    // Two conversations on a past day, either side of Argentine midnight (03:00 UTC).
    await conversation({ createdAt: new Date(`${pastYear}-03-02T02:30:00Z`) }, [
      { role: MessageRole.USER, content: 'Hola' },
      { role: MessageRole.ASSISTANT, content: 'Hola, ¿qué buscás?', tokens: [100, 10] },
    ])
    await conversation({ createdAt: new Date(`${pastYear}-03-02T03:30:00Z`) }, [
      { role: MessageRole.USER, content: 'Tintas' },
      { role: MessageRole.ASSISTANT, content: 'Estas son.', tokens: [200, 20] },
    ])
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      // The past-day fixtures would add up on every run: messages are append-only, so they are removed for real.
      await prisma.unansweredQuestion.deleteMany({ where: { id: { in: questionIds } } })
      await prisma.assistantMessage.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await prisma.assistantConversation.deleteMany({ where: { id: { in: conversationIds } } })
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
      await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('is only for admins', async () => {
    await request(server()).get('/admin/assistant/conversations').expect(401)
    await request(server()).get('/admin/assistant/conversations').set('Cookie', customerCookie).expect(403)
    await request(server()).get('/admin/assistant/usage').set('Cookie', customerCookie).expect(403)
    await request(server())
      .post('/admin/assistant/questions/status')
      .set('Cookie', customerCookie)
      .send({ ids: questionIds, status: 'DISMISSED' })
      .expect(403)
  })

  it('lists conversations by recent activity, with the first question, customer and counters', async () => {
    const page = await get<AdminConversationsPageDto>(`/admin/assistant/conversations?q=${word}`)
    expect(page.total).toBe(2)
    expect(page.items.map(item => item.id)).toEqual([conversationIds[0], conversationIds[1]])
    expect(page.items[0]).toMatchObject({
      status: 'OPEN',
      firstQuestion: `¿Qué impresora ${word} me conviene para fotos?`,
      customer: null,
      customerMessages: 1,
      openQuestions: 0,
      tokens: 990,
    })
    expect(page.items[1]).toMatchObject({
      status: 'ESCALATED',
      escalationReason: 'Pide hablar con una persona',
      customer: { name: 'Ana Prueba', email: customerEmail },
      customerMessages: 2,
      openQuestions: 2,
      tokens: 1210,
    })
  })

  it('filters by status, text, customer, id and days', async () => {
    const ids = async (query: string): Promise<number[]> =>
      (await get<AdminConversationsPageDto>(`/admin/assistant/conversations?${query}`)).items.map(item => item.id)
    expect(await ids(`q=${word}&status=ESCALATED`)).toEqual([conversationIds[1]])
    // Also the assistant's answers and the customer's email.
    expect(await ids(`q=${encodeURIComponent('No la tengo cargada')}&pageSize=100`)).toContain(conversationIds[1])
    expect(await ids(`q=${encodeURIComponent(customerEmail)}`)).toEqual([conversationIds[1]])
    expect(await ids(`q=%23${conversationIds[0]}`)).toEqual([conversationIds[0]])
    // "%" is searched literally, not as a wildcard.
    expect(await ids(`q=${word}%25`)).toEqual([])
    const today = argentineDay(new Date())
    expect(await ids(`q=${word}&from=${today}&to=${today}`)).toHaveLength(2)
    expect(await ids(`from=${pastYear}-03-01&to=${pastYear}-03-01`)).toEqual([conversationIds[2]])
    expect(await ids(`from=${pastYear}-03-02&to=${pastYear}-03-02`)).toEqual([conversationIds[3]])
    await get(`/admin/assistant/conversations?from=${today}`, 400)
    await get('/admin/assistant/conversations?status=LOST', 400)
  })

  it('reads one conversation with its messages, the cards shown and its questions', async () => {
    const detail = await get<AdminConversationDto>(`/admin/assistant/conversations/${conversationIds[0]}`)
    expect(detail.messages.map(message => [message.role, message.content])).toEqual([
      ['USER', `¿Qué impresora ${word} me conviene\n para fotos?`],
      ['ASSISTANT', 'Te muestro dos.'],
    ])
    expect(detail.messages[1]).toMatchObject({ model: 'fake-model', inputTokens: 900, outputTokens: 90 })
    expect(detail.messages[1].products.map(product => [product.id, product.archived, product.status])).toEqual([
      [productIds[0], false, 'DRAFT'],
      [productIds[1], true, 'DRAFT'],
    ])
    expect(detail.messages[0].products).toEqual([])

    const escalated = await get<AdminConversationDto>(`/admin/assistant/conversations/${conversationIds[1]}`)
    expect(escalated).toMatchObject({ status: 'ESCALATED', inputTokens: 1100, outputTokens: 110 })
    expect(escalated.questions.map(question => question.id)).toEqual(questionIds)
    await get('/admin/assistant/conversations/999999999', 404)
    await get('/admin/assistant/conversations/abc', 400)
  })

  it('marks questions answered or dismissed, audits each change and can open them again', async () => {
    const counts = await get<UnansweredQuestionCountsDto>('/admin/assistant/questions/counts')
    expect(Object.keys(counts).sort()).toEqual(['ANSWERED', 'DISMISSED', 'OPEN'])
    expect(counts.OPEN).toBeGreaterThanOrEqual(2)

    const open = await get<UnansweredQuestionsPageDto>(`/admin/assistant/questions?status=OPEN&q=${word}`)
    expect(open.items.map(item => item.id)).toEqual([...questionIds].reverse())
    expect(open.items[0]).toMatchObject({ status: 'OPEN', conversationId: conversationIds[1], resolvedBy: null })

    let result = (await changeStatus([questionIds[0]], 'ANSWERED').expect(200)).body as QuestionStatusResultDto
    expect(result).toEqual({ updated: [questionIds[0]], unchanged: [] })
    result = (await changeStatus(questionIds, 'DISMISSED').expect(200)).body as QuestionStatusResultDto
    expect([...result.updated].sort((a, b) => a - b)).toEqual([...questionIds].sort((a, b) => a - b))
    result = (await changeStatus([questionIds[1], questionIds[1]], 'DISMISSED').expect(200))
      .body as QuestionStatusResultDto
    expect(result).toEqual({ updated: [], unchanged: [questionIds[1]] })

    const dismissed = await get<UnansweredQuestionsPageDto>(`/admin/assistant/questions?status=DISMISSED&q=${word}`)
    expect(dismissed.items).toHaveLength(2)
    expect(dismissed.items[0].resolvedBy).toEqual({ id: userIds[1], name: 'Ana Prueba' })
    expect(dismissed.items[0].resolvedAt).not.toBeNull()

    await changeStatus([questionIds[0]], 'OPEN').expect(200)
    const reopened = await prisma.unansweredQuestion.findUniqueOrThrow({ where: { id: questionIds[0] } })
    expect([reopened.status, reopened.resolvedById, reopened.resolvedAt]).toEqual(['OPEN', null, null])

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'UnansweredQuestion', entityId: { in: questionIds } },
      orderBy: { id: 'asc' },
      select: { action: true, entityId: true, changes: true },
    })
    expect(audit.map(row => [row.action, row.entityId])).toEqual([
      ['assistant-question.answer', questionIds[0]],
      ['assistant-question.dismiss', questionIds[0]],
      ['assistant-question.dismiss', questionIds[1]],
      ['assistant-question.reopen', questionIds[0]],
    ])
    expect(audit[0].changes).toEqual({ status: { from: 'OPEN', to: 'ANSWERED' } })

    await changeStatus([questionIds[0], 999999999], 'DISMISSED').expect(404)
    await changeStatus([], 'DISMISSED').expect(400)
    await changeStatus([questionIds[0]], 'CLOSED').expect(400)
    expect((await prisma.unansweredQuestion.findUniqueOrThrow({ where: { id: questionIds[0] } })).status).toBe('OPEN')
  })

  it('adds up conversations and tokens per Argentine day, the month and today against the limit', async () => {
    const usage = await get<AssistantUsageDto>(`/admin/assistant/usage?from=${pastYear}-03-01&to=${pastYear}-03-03`)
    expect(usage.period).toEqual({ from: `${pastYear}-03-01`, to: `${pastYear}-03-03` })
    expect(usage.days).toEqual([
      { day: `${pastYear}-03-01`, conversations: 1, customerMessages: 1, inputTokens: 100, outputTokens: 10 },
      { day: `${pastYear}-03-02`, conversations: 1, customerMessages: 1, inputTokens: 200, outputTokens: 20 },
      { day: `${pastYear}-03-03`, conversations: 0, customerMessages: 0, inputTokens: 0, outputTokens: 0 },
    ])
    expect(usage.totals).toEqual({ conversations: 2, customerMessages: 2, inputTokens: 300, outputTokens: 30 })
    // The window itself starts and ends at Argentine midnight: 23:30 of the 1st counts, 00:30 of the 2nd does not.
    const oneDay = await get<AssistantUsageDto>(`/admin/assistant/usage?from=${pastYear}-03-01&to=${pastYear}-03-01`)
    expect(oneDay.totals).toEqual({ conversations: 1, customerMessages: 1, inputTokens: 100, outputTokens: 10 })

    const today = argentineDay(new Date())
    const recent = await get<AssistantUsageDto>('/admin/assistant/usage')
    expect(recent.days).toHaveLength(30)
    expect(recent.period.to).toBe(today)
    const todayRow = recent.days.at(-1)!
    expect(todayRow.conversations).toBeGreaterThanOrEqual(2)
    expect(todayRow.inputTokens).toBeGreaterThanOrEqual(2000)
    expect(recent.month.from).toBe(`${today.slice(0, 7)}-01`)
    expect(recent.month.conversations).toBeGreaterThanOrEqual(todayRow.conversations)
    expect(recent.today.tokens).toBe(todayRow.inputTokens + todayRow.outputTokens)
    expect(recent.today.dailyLimit).toBeGreaterThan(0)
    await get(`/admin/assistant/usage?from=${today}&to=${pastYear}-03-01`, 400)
  })
})
