import { Injectable, NotFoundException } from '@nestjs/common'
import { BuyerType } from '../generated/prisma/enums'
import { PricingService } from '../pricing/pricing.service'
import { PrismaService } from '../prisma/prisma.service'
import { AdminProductMapper } from './admin-product.mapper'
import type { AdminProductDetailDto } from './dto/admin/admin-product-response.dto'
import { adminDetailSelect } from './lib/admin-product-selects'

/** Loads the admin view of one product. Shared by every admin product service so each write answers the same shape. */
@Injectable()
export class AdminProductReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly mapper: AdminProductMapper,
  ) {}

  retailListId(): Promise<number | null> {
    return this.pricing.defaultListId(BuyerType.RETAIL)
  }

  async detail(id: number): Promise<AdminProductDetailDto> {
    const retailListId = await this.retailListId()
    const row = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: adminDetailSelect(retailListId),
    })
    if (!row) throw new NotFoundException(`Product ${id} not found`)
    return this.mapper.toDetail(row, retailListId)
  }

  /** Throws 404 unless the product exists and is not archived. */
  async assertExists(id: number): Promise<void> {
    const found = await this.prisma.product.count({ where: { id, deletedAt: null } })
    if (!found) throw new NotFoundException(`Product ${id} not found`)
  }
}
