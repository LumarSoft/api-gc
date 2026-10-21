import { ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { randomInt, randomUUID } from 'node:crypto'
import request from 'supertest'
import type { App } from 'supertest/types'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from '../src/app.module'
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter'
import type { PaginatedProductsDto, ProductSuggestionsDto } from '../src/products/dto/product-response.dto'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Catalog search (local MySQL e2e)', () => {
  let app: NestExpressApplication
  let prisma: PrismaService
  const server = (): App => app.getHttpServer()
  const productIds: number[] = []
  let categoryId: number
  /** A word only this suite's products have, so the rest of the catalog stays out of the results. */
  let word: string
  let code: string
  const names: Record<string, string> = {}

  async function searchPage(query: string): Promise<PaginatedProductsDto> {
    const response = await request(server())
      .get(`/products?q=${encodeURIComponent(query)}&pageSize=24`)
      .expect(200)
    return response.body as PaginatedProductsDto
  }

  async function search(query: string): Promise<string[]> {
    const response = await request(server())
      .get(`/products?q=${encodeURIComponent(query)}&pageSize=24`)
      .expect(200)
    return (response.body as PaginatedProductsDto).items.map(item => item.name)
  }

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = fixture.createNestApplication<NestExpressApplication>()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter))
    await app.listen(0, '127.0.0.1')
    prisma = app.get(PrismaService)

    const suffix = randomUUID().slice(0, 8)
    word = `busqueda${suffix}`
    code = String(randomInt(10_000, 99_999))
    categoryId = (await prisma.category.create({ data: { name: 'Search test', slug: `search-${suffix}` } })).id
    const fixtures = [
      { key: 'wireless', name: `Impresora Inalámbrica ${word}`, specs: [] as string[] },
      { key: 'wifiSpec', name: `Impresora Compacta ${word}`, specs: ['USB de alta velocidad, Wi-Fi Direct'] },
      {
        key: 'usb',
        name: `Impresora Básica ${word}`,
        specs: ['USB de alta velocidad', 'https://example.com/ficha-wifi-zq9.pdf'],
      },
      { key: 'scanner', name: `Escáner Dúplex ${word}`, specs: [] },
      { key: 'receipts', name: `Impresora Térmica de Recibos QZ-T${code}III ${word}`, specs: [] },
      { key: 'draft', name: `Impresora Inalámbrica Borrador ${word}`, specs: [], draft: true },
    ]
    for (const [index, item] of fixtures.entries()) {
      names[item.key] = item.name
      const product = await prisma.product.create({
        data: {
          name: item.name,
          slug: `search-${suffix}-${item.key.toLowerCase()}`,
          categoryId,
          status: item.draft ? 'DRAFT' : 'PUBLISHED',
          publishedAt: new Date(2020, 0, index + 1),
          specifications: {
            create: item.specs.map(value => ({ groupName: 'Conectividad', name: 'Interfaces', value })),
          },
          variants: {
            create: { sku: `SEARCH-${suffix}-${index}`.toUpperCase(), isDefault: true },
          },
        },
        select: { id: true },
      })
      productIds.push(product.id)
    }
  })

  afterAll(async () => {
    if (prisma) {
      const now = new Date()
      await prisma.productSpecification.updateMany({
        where: { productId: { in: productIds } },
        data: { deletedAt: now },
      })
      await prisma.productVariant.updateMany({ where: { productId: { in: productIds } }, data: { deletedAt: now } })
      await prisma.product.updateMany({ where: { id: { in: productIds } }, data: { deletedAt: now } })
      await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: now } })
    }
    if (app) await app.close()
  })

  it('finds "wifi" under the names the catalog uses, name matches before specification matches', async () => {
    const expected = [names.wireless, names.wifiSpec]
    expect(await search(`${word} wifi`)).toEqual(expected)
    expect(await search(`impresoras ${word} con wi fi`)).toEqual(expected)
    expect(await search(`${word} inalámbricas`)).toEqual(expected)
    // Only in the link to its spec sheet (z and q never appear in the random hex word): no product has both words.
    expect((await searchPage(`${word} zq9`)).search?.partial).toBe(true)
  })

  it('needs every word, in any order', async () => {
    expect(await search(`dúplex ${word}`)).toEqual([names.scanner])
    expect(await search(`${word} escaner`)).toEqual([names.scanner])
    // No product has both: the closest ones, flagged as such.
    expect((await searchPage(`${word} plotter`)).search?.partial).toBe(true)
  })

  it('finds model codes written with or without separators', async () => {
    for (const query of [`qzt${code}`, `QZ-T${code}`, `qz-t${code}iii`])
      expect(await search(query)).toEqual([names.receipts])
  })

  it('finds receipt printers by what customers call them', async () => {
    expect(await search(`comandera ${word}`)).toEqual([names.receipts])
    expect(await search(`ticketera ${word}`)).toEqual([names.receipts])
  })

  it('keeps the other sorts and never shows drafts', async () => {
    const response = await request(server())
      .get(`/products?q=${encodeURIComponent(`impresora ${word}`)}&sort=name&pageSize=24`)
      .expect(200)
    const page = response.body as PaginatedProductsDto
    expect(page.items.map(item => item.name)).toEqual(
      [names.usb, names.wifiSpec, names.wireless, names.receipts].sort((a, b) => a.localeCompare(b, 'es')),
    )
    expect(page.total).toBe(4)
  })

  it('corrects a misspelled word and says what it searched', async () => {
    const response = await request(server())
      .get(`/products?q=${encodeURIComponent(`impresra ${word}`)}&pageSize=24`)
      .expect(200)
    const page = response.body as PaginatedProductsDto
    expect(page.items.map(item => item.name)).toEqual(
      expect.arrayContaining([names.wireless, names.wifiSpec, names.usb, names.receipts]),
    )
    expect(page.search).toEqual({ correctedQuery: `impresora ${word}`, partial: false })
  })

  it('shows the closest products when none has every word, and says so', async () => {
    const page = (
      await request(server())
        .get(`/products?q=${encodeURIComponent(`${word} heladera`)}`)
        .expect(200)
    ).body as PaginatedProductsDto
    expect(page.total).toBe(5)
    expect(page.search).toEqual({ correctedQuery: null, partial: true })
    const none = (await request(server()).get(`/products?q=zqzq${code}heladera`).expect(200))
      .body as PaginatedProductsDto
    expect(none).toMatchObject({ total: 0, search: { correctedQuery: null, partial: false } })
  })

  it('suggests the first products and their categories while the customer types', async () => {
    const response = await request(server())
      .get(`/products/suggest?q=${encodeURIComponent(`${word} wifi`)}`)
      .expect(200)
    const suggestions = response.body as ProductSuggestionsDto
    expect(suggestions).toMatchObject({ query: `${word} wifi`, correctedQuery: null, partial: false, total: 2 })
    expect(suggestions.products.map(product => product.name)).toEqual([names.wireless, names.wifiSpec])
    expect(suggestions.categories).toEqual([
      { slug: expect.stringMatching(/^search-/) as string, name: 'Search test', count: 2 },
    ])
    await request(server()).get('/products/suggest').expect(400)
    await request(server())
      .get(`/products/suggest?q=${'a'.repeat(101)}`)
      .expect(400)
  })
})
