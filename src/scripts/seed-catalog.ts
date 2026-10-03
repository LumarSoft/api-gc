/**
 * Loads the starter catalog from prisma/seed/catalog.json (+ images in prisma/seed/images).
 *
 *   npm run db:seed
 *
 * Idempotent: it only creates what is missing (matched by slug / SKU / code) and never overwrites data edited later
 * from the admin panel. Product content comes from the official epson.com.ar pages; prices and stock are SAMPLE data.
 */
import 'dotenv/config'
import { Logger, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FilesModule } from '../files/files.module'
import { FilesService } from '../files/files.service'
import { Prisma } from '../generated/prisma/client'
import {
  BuyerType,
  Currency,
  DataSource,
  FileVisibility,
  ProductStatus,
  StockBucket,
  StockMovementReason,
} from '../generated/prisma/enums'
import { PrismaModule } from '../prisma/prisma.module'
import { PrismaService } from '../prisma/prisma.service'

const SEED_DIR = resolve('prisma/seed')
/** SAMPLE: wholesale prices are derived from retail ones only to have something to show. */
const SAMPLE_WHOLESALE_FACTOR = new Prisma.Decimal('0.88')
/** Spread publication dates so some products show the NEW badge and "newest" sorting is meaningful. */
const DAYS_BETWEEN_SEEDED_PRODUCTS = 3

interface SeedVariant {
  sku: string
  name: string | null
  optionValues: Record<string, string> | null
  images: string[]
  samplePrice: { amount: string; currency: Currency; compareAtAmount: string | null }
  sampleStock: number
}

interface SeedProduct {
  name: string
  slug: string
  category: string
  brand: string
  shortDescription: string
  description: string
  specifications: { group: string; name: string; value: string }[]
  isFeatured: boolean
  tags: string[]
  compatibleWith?: string[]
  variants: SeedVariant[]
}

interface SeedCatalog {
  categories: { slug: string; name: string; children?: { slug: string; name: string }[] }[]
  brands: { slug: string; name: string }[]
  tags: { slug: string; name: string; group: string }[]
  sampleExchangeRate: { currency: Currency; rate: string }
  products: SeedProduct[]
}

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, FilesModule] })
class SeedModule {}

const logger = new Logger('SeedCatalog')

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn', 'log'] })
  const prisma = app.get(PrismaService)
  const files = app.get(FilesService)

  try {
    const catalog = JSON.parse(await readFile(join(SEED_DIR, 'catalog.json'), 'utf-8')) as SeedCatalog

    const brandIds = await seedBrands(prisma, catalog)
    const categoryIds = await seedCategories(prisma, catalog)
    const tagIds = await seedTags(prisma, catalog)
    const priceLists = await seedPriceLists(prisma)
    await seedExchangeRate(prisma, catalog)

    let created = 0
    for (const [index, product] of catalog.products.entries()) {
      const exists = await prisma.product.findUnique({ where: { slug: product.slug }, select: { id: true } })
      if (exists) continue
      await seedProduct(prisma, files, product, index, { brandIds, categoryIds, tagIds, priceLists })
      created++
    }
    await seedCompatibility(prisma, catalog)

    logger.log(`Catalog ready: ${created} new products (${catalog.products.length - created} already existed)`)
  } finally {
    await app.close()
  }
}

async function seedBrands(prisma: PrismaService, catalog: SeedCatalog): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  for (const [index, brand] of catalog.brands.entries()) {
    const row = await prisma.brand.upsert({
      where: { slug: brand.slug },
      update: {},
      create: { slug: brand.slug, name: brand.name, sortOrder: index },
      select: { id: true },
    })
    ids.set(brand.slug, row.id)
  }
  return ids
}

async function seedCategories(prisma: PrismaService, catalog: SeedCatalog): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  for (const [index, category] of catalog.categories.entries()) {
    const parent = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { slug: category.slug, name: category.name, sortOrder: index },
      select: { id: true },
    })
    ids.set(category.slug, parent.id)
    for (const [childIndex, child] of (category.children ?? []).entries()) {
      const row = await prisma.category.upsert({
        where: { slug: child.slug },
        update: {},
        create: { slug: child.slug, name: child.name, sortOrder: childIndex, parentId: parent.id },
        select: { id: true },
      })
      ids.set(child.slug, row.id)
    }
  }
  return ids
}

async function seedTags(prisma: PrismaService, catalog: SeedCatalog): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  for (const tag of catalog.tags) {
    const row = await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: {},
      create: { slug: tag.slug, name: tag.name, group: tag.group },
      select: { id: true },
    })
    ids.set(tag.slug, row.id)
  }
  return ids
}

async function seedPriceLists(prisma: PrismaService): Promise<{ retail: number; wholesale: number }> {
  const upsertList = (code: string, name: string, audience: BuyerType): Promise<{ id: number }> =>
    prisma.priceList.upsert({
      where: { code },
      update: {},
      create: { code, name, audience, isDefault: true },
      select: { id: true },
    })
  const [retail, wholesale] = await Promise.all([
    upsertList('RETAIL', 'Precio de lista', BuyerType.RETAIL),
    upsertList('WHOLESALE', 'Clientes frecuentes', BuyerType.WHOLESALE),
  ])
  return { retail: retail.id, wholesale: wholesale.id }
}

async function seedExchangeRate(prisma: PrismaService, catalog: SeedCatalog): Promise<void> {
  const { currency, rate } = catalog.sampleExchangeRate
  const existing = await prisma.exchangeRate.findFirst({ where: { currency }, select: { id: true } })
  if (existing) return
  // SAMPLE rate so USD-priced products show a price in development. Set the real one from the admin panel.
  await prisma.exchangeRate.create({ data: { currency, rate: new Prisma.Decimal(rate), source: DataSource.MANUAL } })
}

async function seedProduct(
  prisma: PrismaService,
  files: FilesService,
  product: SeedProduct,
  index: number,
  refs: {
    brandIds: Map<string, number>
    categoryIds: Map<string, number>
    tagIds: Map<string, number>
    priceLists: { retail: number; wholesale: number }
  },
): Promise<void> {
  const categoryId = refs.categoryIds.get(product.category)
  if (!categoryId) throw new Error(`Unknown category ${product.category} for ${product.slug}`)

  // Copy images first: a failed copy must not leave a half-created product.
  const images = new Map<string, { storageKey: string; sizeBytes: number }>()
  for (const fileName of product.variants.flatMap(variant => variant.images)) {
    const sourcePath = join(SEED_DIR, 'images', fileName)
    const storageKey = `products/${fileName}`
    await files.copyIntoPublic(sourcePath, storageKey)
    images.set(fileName, { storageKey, sizeBytes: (await stat(sourcePath)).size })
  }

  const publishedAt = new Date(Date.now() - index * DAYS_BETWEEN_SEEDED_PRODUCTS * 24 * 60 * 60 * 1000)
  const hasVariants = product.variants.length > 1

  await prisma.$transaction(async tx => {
    const { id: productId } = await tx.product.create({
      data: {
        name: product.name,
        slug: product.slug,
        status: ProductStatus.PUBLISHED,
        publishedAt,
        isFeatured: product.isFeatured,
        shortDescription: product.shortDescription,
        description: product.description,
        categoryId,
        brandId: refs.brandIds.get(product.brand) ?? null,
        specifications: {
          create: product.specifications.map((spec, sortOrder) => ({
            groupName: spec.group,
            name: spec.name,
            value: spec.value,
            sortOrder,
          })),
        },
        tags: {
          create: product.tags
            .map(slug => refs.tagIds.get(slug))
            .filter((tagId): tagId is number => tagId !== undefined)
            .map(tagId => ({ tagId })),
        },
      },
      select: { id: true },
    })

    for (const [variantIndex, variant] of product.variants.entries()) {
      const retailAmount = new Prisma.Decimal(variant.samplePrice.amount)
      const { id: variantId } = await tx.productVariant.create({
        data: {
          productId,
          sku: variant.sku,
          name: variant.name,
          optionValues: variant.optionValues ?? Prisma.DbNull,
          isDefault: variantIndex === 0,
          prices: {
            create: [
              {
                priceListId: refs.priceLists.retail,
                amount: retailAmount,
                currency: variant.samplePrice.currency,
                compareAtAmount: variant.samplePrice.compareAtAmount
                  ? new Prisma.Decimal(variant.samplePrice.compareAtAmount)
                  : null,
              },
              {
                priceListId: refs.priceLists.wholesale,
                amount: retailAmount.mul(SAMPLE_WHOLESALE_FACTOR).toDecimalPlaces(2),
                currency: variant.samplePrice.currency,
              },
            ],
          },
          inventory: { create: { onHand: variant.sampleStock } },
        },
        select: { id: true },
      })

      // Every stock change is recorded as a movement, including the initial one.
      if (variant.sampleStock > 0) {
        await tx.stockMovement.create({
          data: {
            variantId,
            bucket: StockBucket.ON_HAND,
            quantity: variant.sampleStock,
            reason: StockMovementReason.ADJUSTMENT,
            note: 'Stock inicial de ejemplo (seed)',
          },
        })
      }

      for (const [imageIndex, fileName] of variant.images.entries()) {
        const { storageKey, sizeBytes } = images.get(fileName) as { storageKey: string; sizeBytes: number }
        const file = await tx.storedFile.upsert({
          where: { storageKey },
          update: {},
          create: {
            storageKey,
            originalName: fileName,
            mimeType: 'image/jpeg',
            sizeBytes,
            visibility: FileVisibility.PUBLIC,
          },
          select: { id: true },
        })
        await tx.productImage.create({
          data: {
            productId,
            variantId: hasVariants ? variantId : null,
            fileId: file.id,
            altText: variant.name ? `${product.name} — ${variant.name}` : product.name,
            // The first variant's photos represent the product in listings.
            sortOrder: variantIndex * 10 + imageIndex,
          },
        })
      }
    }
  })
}

async function seedCompatibility(prisma: PrismaService, catalog: SeedCatalog): Promise<void> {
  for (const product of catalog.products.filter(item => item.compatibleWith?.length)) {
    const consumable = await prisma.product.findUnique({ where: { slug: product.slug }, select: { id: true } })
    if (!consumable) continue
    const targets = await prisma.productVariant.findMany({
      where: { sku: { in: product.compatibleWith } },
      select: { productId: true },
    })
    await prisma.productCompatibility.createMany({
      data: targets.map(target => ({ productId: consumable.id, targetProductId: target.productId })),
      skipDuplicates: true,
    })
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
