import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { AuditLogsService } from '../audit-logs/audit-logs.service'
import { diffForAudit } from '../audit-logs/lib/audit-diff'
import type { AuditActor } from '../common/types/audit-actor'
import { Prisma, type ProductVariant } from '../generated/prisma/client'
import { DataSource, ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import { hasShippingData } from '../shipping/lib/shipping-rules'
import { AdminProductReader } from './admin-product.reader'
import { CatalogReferences } from './catalog-references'
import type { AdminProductDetailDto } from './dto/admin/admin-product-response.dto'
import { CreateVariantDto } from './dto/admin/create-variant.dto'
import { UpdateVariantDto } from './dto/admin/update-variant.dto'
import { nextDefault, optionValuesError } from './lib/variant-rules'

type VariantFields = Pick<
  Prisma.ProductVariantUncheckedCreateInput,
  | 'name'
  | 'optionValues'
  | 'barcode'
  | 'isActive'
  | 'saleUnit'
  | 'unitsPerSaleUnit'
  | 'weightGrams'
  | 'lengthMm'
  | 'widthMm'
  | 'heightMm'
>

/** Sellable SKUs of a product: add, edit, choose the default one, archive. */
@Injectable()
export class AdminVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: AdminProductReader,
    private readonly references: CatalogReferences,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async create(productId: number, dto: CreateVariantDto, actor: AuditActor): Promise<AdminProductDetailDto> {
    await this.reader.assertExists(productId)
    await this.references.assertSkuFree(dto.sku)
    this.assertOptions(dto.optionValues)
    await this.assertShippable(productId, dto)

    const data = this.toData(dto)
    await this.prisma.$transaction(async tx => {
      const variant = await tx.productVariant.create({
        data: {
          ...data,
          isActive: dto.isActive ?? true,
          sku: dto.sku,
          productId,
          source: DataSource.MANUAL,
          isDefault: false,
        },
        select: { id: true },
      })
      await this.auditLogs.record(
        actor,
        {
          action: 'variant.create',
          entityType: 'ProductVariant',
          entityId: variant.id,
          changes: diffForAudit(null, { ...dto }),
        },
        tx,
      )
    })
    return this.reader.detail(productId)
  }

  async update(
    productId: number,
    variantId: number,
    dto: UpdateVariantDto,
    actor: AuditActor,
  ): Promise<AdminProductDetailDto> {
    const current = await this.findOwn(productId, variantId)
    if (dto.sku && dto.sku !== current.sku) await this.references.assertSkuFree(dto.sku, variantId)
    this.assertOptions(dto.optionValues)
    if (dto.isActive === false && current.isDefault) {
      throw new UnprocessableEntityException('Choose another default variant before deactivating this one')
    }
    await this.assertShippable(productId, dto, current)

    const data = { ...this.toData(dto), sku: dto.sku ?? undefined }
    const changes = diffForAudit(current, { ...dto })
    if (Object.keys(changes).length > 0) {
      await this.prisma.$transaction(async tx => {
        await tx.productVariant.update({ where: { id: variantId }, data })
        await this.auditLogs.record(
          actor,
          { action: 'variant.update', entityType: 'ProductVariant', entityId: variantId, changes },
          tx,
        )
      })
    }
    return this.reader.detail(productId)
  }

  /**
   * A published product keeps weight and measurements on every active variant (see admin-product-rules). `current`
   * fills the fields an update leaves out.
   */
  private async assertShippable(productId: number, dto: UpdateVariantDto, current?: ProductVariant): Promise<void> {
    const pick = <K extends 'isActive' | 'weightGrams' | 'lengthMm' | 'widthMm' | 'heightMm'>(
      key: K,
    ): ProductVariant[K] | null => (dto[key] !== undefined ? (dto[key] as ProductVariant[K]) : (current?.[key] ?? null))
    const active = pick('isActive') ?? true
    const measured = hasShippingData({
      weightGrams: pick('weightGrams'),
      lengthMm: pick('lengthMm'),
      widthMm: pick('widthMm'),
      heightMm: pick('heightMm'),
    })
    if (!active || measured) return
    const product = await this.prisma.product.findUnique({ where: { id: productId }, select: { status: true } })
    if (product?.status === ProductStatus.PUBLISHED)
      throw new UnprocessableEntityException(
        'A published product needs weight and measurements on every active variant',
      )
  }

  /** The default variant is the one preselected on the product page. It must be active. */
  async setDefault(productId: number, variantId: number, actor: AuditActor): Promise<AdminProductDetailDto> {
    const variant = await this.findOwn(productId, variantId)
    if (!variant.isActive)
      throw new UnprocessableEntityException('Activate the variant before making it the default one')
    await this.prisma.$transaction(async tx => {
      await tx.productVariant.updateMany({ where: { productId, isDefault: true }, data: { isDefault: false } })
      await tx.productVariant.update({ where: { id: variantId }, data: { isDefault: true } })
      await this.auditLogs.record(
        actor,
        { action: 'variant.default', entityType: 'ProductVariant', entityId: variantId },
        tx,
      )
    })
    return this.reader.detail(productId)
  }

  /** Soft delete. A product keeps at least one variant; archiving the default promotes another one. */
  async archive(productId: number, variantId: number, actor: AuditActor): Promise<AdminProductDetailDto> {
    const variant = await this.findOwn(productId, variantId)
    const remaining = await this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null, id: { not: variantId } },
      orderBy: { id: 'asc' },
      select: { id: true, isActive: true },
    })
    if (remaining.length === 0) throw new UnprocessableEntityException('A product needs at least one variant')
    const promoted = variant.isDefault ? nextDefault(remaining) : undefined
    if (variant.isDefault && !promoted) {
      throw new UnprocessableEntityException('Activate another variant before archiving the default one')
    }

    await this.prisma.$transaction(async tx => {
      await tx.productVariant.update({ where: { id: variantId }, data: { deletedAt: new Date(), isDefault: false } })
      // Photos of this variant stay in the gallery as general photos.
      await tx.productImage.updateMany({ where: { variantId }, data: { variantId: null } })
      if (promoted) await tx.productVariant.update({ where: { id: promoted.id }, data: { isDefault: true } })
      await this.auditLogs.record(
        actor,
        { action: 'variant.archive', entityType: 'ProductVariant', entityId: variantId },
        tx,
      )
    })
    return this.reader.detail(productId)
  }

  /** The variant, if it belongs to the product and is not archived. */
  async findOwn(productId: number, variantId: number): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null, product: { deletedAt: null } },
    })
    if (!variant) throw new NotFoundException(`Variant ${variantId} not found in product ${productId}`)
    return variant
  }

  private assertOptions(options: Record<string, unknown> | null | undefined): void {
    const error = optionValuesError(options)
    if (error) throw new BadRequestException(error)
  }

  /** Optional columns: undefined = unchanged, null = cleared. Required columns never receive null. */
  private toData(dto: UpdateVariantDto): VariantFields {
    return {
      name: dto.name,
      optionValues: dto.optionValues === null ? Prisma.DbNull : dto.optionValues,
      barcode: dto.barcode,
      isActive: dto.isActive ?? undefined,
      saleUnit: dto.saleUnit ?? undefined,
      unitsPerSaleUnit: dto.unitsPerSaleUnit ?? undefined,
      weightGrams: dto.weightGrams,
      lengthMm: dto.lengthMm,
      widthMm: dto.widthMm,
      heightMm: dto.heightMm,
    }
  }
}
