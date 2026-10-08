import { Injectable, NotFoundException } from '@nestjs/common'
import { ActivityType, ProductStatus } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { RecordActivityDto } from './dto/record-activity.dto'
import { isBot, normalizeSearch, PRODUCT_EVENTS } from './lib/activity-rules'

/** Stores anonymous store activity for the stats page. No account, IP or personal data is kept. */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: RecordActivityDto, userAgent: string | undefined): Promise<void> {
    if (isBot(userAgent)) return
    const productEvent = PRODUCT_EVENTS.includes(event.type)
    const search = event.type === ActivityType.SEARCH
    if (productEvent) {
      // Only published products are visible in the store; anything else would let anyone probe draft ids.
      const product = await this.prisma.product.findFirst({
        where: { id: event.productId, deletedAt: null, status: ProductStatus.PUBLISHED },
        select: { id: true },
      })
      if (!product) throw new NotFoundException(`Product ${event.productId} not found`)
    }
    const query = search ? normalizeSearch(event.query ?? '') : ''
    if (search && !query) return
    await this.prisma.activityEvent.create({
      data: {
        type: event.type,
        visitorId: event.visitorId.toLowerCase(),
        productId: productEvent ? event.productId : null,
        searchQuery: search ? query : null,
        resultCount: search ? event.resultCount : null,
      },
    })
  }
}
