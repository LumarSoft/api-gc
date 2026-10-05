import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/** Checks that what an admin write points to exists (category, brand) or is free (SKU), with clear messages. */
@Injectable()
export class CatalogReferences {
  constructor(private readonly prisma: PrismaService) {}

  async assertCategory(id: number): Promise<void> {
    const found = await this.prisma.category.count({ where: { id, deletedAt: null } })
    if (!found) throw new BadRequestException(`Category ${id} does not exist`)
  }

  async assertBrand(id: number): Promise<void> {
    const found = await this.prisma.brand.count({ where: { id, deletedAt: null } })
    if (!found) throw new BadRequestException(`Brand ${id} does not exist`)
  }

  /** SKUs are unique forever (archived variants keep theirs). `exceptVariantId`: the variant being edited. */
  async assertSkuFree(sku: string, exceptVariantId?: number): Promise<void> {
    const holder = await this.prisma.productVariant.findUnique({
      where: { sku },
      select: { id: true, deletedAt: true, product: { select: { deletedAt: true } } },
    })
    if (!holder || holder.id === exceptVariantId) return
    const archived = holder.deletedAt !== null || holder.product.deletedAt !== null
    throw new ConflictException(
      archived ? `The SKU "${sku}" belongs to an archived record` : `The SKU "${sku}" is already in use`,
    )
  }
}
