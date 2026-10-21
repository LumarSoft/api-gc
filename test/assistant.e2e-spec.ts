import { ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module'
import {
  ASSISTANT_MODEL,
  AssistantModelError,
  type AssistantModel,
  type ChatMessage,
  type TurnEvent,
  type TurnRequest,
} from '../src/assistant/assistant-model'
import type { AssistantStreamEvent } from '../src/assistant/dto/assistant-stream.dto'
import { MAX_CUSTOMER_MESSAGES } from '../src/assistant/lib/assistant-limits'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import { hashToken } from '../src/common/utils/secure-token'
import { BuyerType } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/prisma/prisma.service'

/** Scripted model: searches by the customer's words, shows what it found and says how many messages it read. */
class FakeModel implements AssistantModel {
  configured = true
  readonly name = 'fake-model'
  fail = false
  histories: ChatMessage[][] = []
  instructions: string[] = []

  async *runTurn<D>(request: TurnRequest<D>): AsyncGenerator<TurnEvent<D>> {
    this.histories.push(request.history)
    this.instructions.push(request.instructions)
    if (this.fail) throw new AssistantModelError('down')
    const question = request.history[request.history.length - 1].text
    const found = (await request.runTool('search_products', { text: question, sort: 'price-asc' })).output as {
      products: { slug: string }[]
    }
    yield { type: 'usage', inputTokens: 100, outputTokens: 10 }
    yield { type: 'text', delta: 'Te recomiendo ' }
    yield { type: 'text', delta: `estas opciones (leí ${request.history.length} mensajes).` }
    const shown = await request.runTool('show_products', { slugs: found.products.map(product => product.slug) })
    if (shown.display) yield { type: 'display', display: shown.display }
    yield { type: 'usage', inputTokens: 50, outputTokens: 5 }
  }
}

describe('Assistant (local MySQL e2e)', () => {
  let app: NestExpressApplication
  let prisma: PrismaService
  const model = new FakeModel()
  const productIds: number[] = []
  const conversationIds: number[] = []
  let categoryId: number
  let word: string
  const server = (): App => app.getHttpServer()
  /** Each test talks from its own IP (the API trusts one proxy hop), so the 10/min limit is tested on its own. */
  let ip = ''

  /** Sends a message and returns the streamed events. */
  async function ask(body: object, status = 200): Promise<AssistantStreamEvent[]> {
    const response = await request(server())
      .post('/assistant/messages')
      .set('X-Forwarded-For', ip)
      .send(body)
      .expect(status)
    if (status !== 200) return []
    expect(response.headers['content-type']).toMatch(/application\/x-ndjson/)
    const events = response.text
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as AssistantStreamEvent)
    const token = events.find(event => event.type === 'conversation')
    if (token?.type === 'conversation') {
      const row = await prisma.assistantConversation.findFirstOrThrow({ where: { sessionId: hashToken(token.token) } })
      conversationIds.push(row.id)
    }
    return events
  }

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ASSISTANT_MODEL)
      .useValue(model)
      .compile()
    app = fixture.createNestApplication<NestExpressApplication>()
    app.set('trust proxy', 1)
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)

    const suffix = randomUUID().slice(0, 8)
    word = `asesorprueba${suffix}`
    const priceListId = (
      await prisma.priceList.findFirstOrThrow({
        where: { audience: BuyerType.RETAIL, isDefault: true, deletedAt: null },
        select: { id: true },
      })
    ).id
    categoryId = (await prisma.category.create({ data: { name: 'Assistant test', slug: `assistant-${suffix}` } })).id
    for (const [name, amount, status] of [
      ['Cara', '900.00', 'PUBLISHED'],
      ['Barata', '100.00', 'PUBLISHED'],
      ['Borrador', '50.00', 'DRAFT'],
    ] as const) {
      const product = await prisma.product.create({
        data: {
          name: `${name} ${word}`,
          slug: `assistant-${suffix}-${name.toLowerCase()}`,
          categoryId,
          status,
          publishedAt: new Date('2020-01-01'),
          variants: {
            create: {
              sku: `ASSISTANT-${suffix}-${name}`.toUpperCase(),
              isDefault: true,
              inventory: { create: { onHand: 5 } },
              prices: { create: { priceListId, amount, currency: 'ARS' } },
            },
          },
        },
        select: { id: true },
      })
      productIds.push(product.id)
    }
  })

  beforeEach(() => {
    ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      await prisma.assistantConversation.updateMany({
        where: { id: { in: conversationIds } },
        data: { deletedAt: now },
      })
      await prisma.productVariant.updateMany({ where: { productId: { in: productIds } }, data: { deletedAt: now } })
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('streams the answer with cards of published products, priced for the buyer, and records it', async () => {
    const events = await ask({ message: `  Busco una ${word}  ` })
    expect(events.map(event => event.type)).toEqual(['conversation', 'text', 'text', 'products', 'done'])
    const cards = events.find(event => event.type === 'products')
    expect(cards?.type === 'products' && cards.items.map(item => [item.name, item.price?.amount])).toEqual([
      [`Barata ${word}`, '100.00'],
      [`Cara ${word}`, '900.00'],
    ])
    expect(cards?.type === 'products' && cards.items.every(item => typeof item.variantId === 'number')).toBe(true)

    const conversation = await prisma.assistantConversation.findUniqueOrThrow({
      where: { id: conversationIds[0] },
      select: { inputTokens: true, outputTokens: true, messages: { orderBy: { id: 'asc' } } },
    })
    expect([conversation.inputTokens, conversation.outputTokens]).toEqual([150, 15])
    expect(conversation.messages.map(message => [message.role, message.content])).toEqual([
      ['USER', `Busco una ${word}`],
      ['ASSISTANT', 'Te recomiendo estas opciones (leí 1 mensajes).'],
    ])
    expect(conversation.messages[1]).toMatchObject({
      model: 'fake-model',
      recommendedProducts: [productIds[1], productIds[0]],
    })
  })

  it('continues a conversation only with its token, remembering the cards it showed', async () => {
    const first = await ask({ message: word })
    const token = first[0].type === 'conversation' ? first[0].token : ''
    const second = await ask({ message: `otra ${word}`, conversation: token })
    expect(second.some(event => event.type === 'conversation')).toBe(false)
    const history = model.histories[model.histories.length - 1]
    expect(history).toHaveLength(3)
    expect(history[1].text).toContain(`[Tarjetas mostradas: assistant-`)

    await ask({ message: 'hola', conversation: 'x'.repeat(64) }, 404)
    await ask({ message: 'hola', conversation: 'short' }, 400)
  })

  it('tells the model which product page the customer is on', async () => {
    const slug = (await prisma.product.findUniqueOrThrow({ where: { id: productIds[0] } })).slug
    await ask({ message: word, productSlug: slug })
    expect(model.instructions[model.instructions.length - 1]).toContain(`(slug ${slug})`)
  })

  it('refuses empty or long messages and conversations past their limit', async () => {
    await ask({ message: '   ' }, 400)
    await ask({ message: 'a'.repeat(1001) }, 400)
    const events = await ask({ message: word })
    const token = events[0].type === 'conversation' ? events[0].token : ''
    await prisma.assistantMessage.createMany({
      data: Array.from({ length: MAX_CUSTOMER_MESSAGES }, () => ({
        conversationId: conversationIds[conversationIds.length - 1],
        role: 'USER' as const,
        content: 'relleno',
      })),
    })
    await ask({ message: word, conversation: token }, 422)
  })

  it('ends with an error line when the model fails, and is unavailable without credentials', async () => {
    model.fail = true
    const events = await ask({ message: word })
    expect(events.map(event => event.type)).toEqual(['conversation', 'error', 'done'])
    model.fail = false

    model.configured = false
    await ask({ message: word }, 503)
    model.configured = true
  })

  it('takes at most 10 messages per minute from one IP', async () => {
    for (let i = 0; i < 10; i++) await ask({ message: ' ' }, 400)
    await ask({ message: word }, 429)
  })
})
