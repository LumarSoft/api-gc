import { Inject, Injectable } from '@nestjs/common'
import { checkoutDeliveryOptions } from '../checkout/lib/checkout-delivery'
import { argentineDay } from '../common/utils/report-period'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { BuyerType, DeliveryMethod, ProductStatus } from '../generated/prisma/enums'
import { PAYMENT_GATEWAY, type PaymentGateway } from '../mercado-pago/payment-gateway'
import { reservationHours } from '../orders/lib/reservation-hours'
import { PrismaService } from '../prisma/prisma.service'
import { RESERVATION_HOURS_KEY } from '../settings/lib/settings-rules'
import { SHIPPING_CARRIER, type ShippingCarrier } from '../shipping/shipping-carrier'
import { AssistantCatalogService } from './assistant-catalog.service'
import { assistantInstructions, type CatalogMap, type StoreFacts } from './lib/assistant-instructions'
import { priceLabel } from './lib/catalog-search-rules'

/** Store facts and the catalog map change rarely; staff edits reach the assistant within this time. */
const CACHE_MS = 5 * 60 * 1000

/** Builds the instructions of each turn: standing rules, what the store offers today and who is asking. */
@Injectable()
export class AssistantContextService {
  private cached: { facts: StoreFacts; catalog: CatalogMap; until: number } | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: AssistantCatalogService,
    @Inject(SHIPPING_CARRIER) private readonly carrier: ShippingCarrier,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async instructions(user: AuthenticatedUser | undefined, productSlug: string | undefined): Promise<string> {
    const [{ facts, catalog }, viewingName] = await Promise.all([
      this.storeContext(),
      productSlug ? this.catalog.visibleName(productSlug) : null,
    ])
    return assistantInstructions(facts, catalog, {
      frequentCustomer: user?.buyerType === BuyerType.WHOLESALE,
      signedIn: Boolean(user),
      viewing: viewingName && productSlug ? { name: viewingName, slug: productSlug } : null,
      today: argentineDay(new Date()),
    })
  }

  private async storeContext(): Promise<{ facts: StoreFacts; catalog: CatalogMap }> {
    if (this.cached && this.cached.until > Date.now()) return this.cached
    const [facts, catalog] = await Promise.all([this.storeFacts(), this.catalogMap()])
    this.cached = { facts, catalog, until: Date.now() + CACHE_MS }
    return this.cached
  }

  private async storeFacts(): Promise<StoreFacts> {
    const [local, reservation] = await Promise.all([
      this.prisma.shippingMethod.findFirst({
        where: { code: DeliveryMethod.LOCAL_DELIVERY, deletedAt: null },
        select: {
          code: true,
          name: true,
          description: true,
          isActive: true,
          currency: true,
          flatRate: true,
          freeShippingThreshold: true,
        },
      }),
      this.prisma.setting.findUnique({
        where: { key: RESERVATION_HOURS_KEY },
        select: { value: true, deletedAt: true },
      }),
    ])
    // Same rule as checkout: Rosario delivery is offered only when it is on and has an ARS rate.
    const delivery = checkoutDeliveryOptions(local ? [local] : [], null, {
      enabled: false,
      reason: null,
      cost: null,
    }).find(option => option.code === DeliveryMethod.LOCAL_DELIVERY)
    return {
      localDelivery:
        delivery?.enabled && delivery.cost
          ? {
              flatRate: priceLabel(delivery.cost)!,
              freeFrom: local?.freeShippingThreshold
                ? priceLabel({ amount: local.freeShippingThreshold.toFixed(2), currency: local.currency })
                : null,
            }
          : null,
      carrierShipping: this.carrier.configured,
      onlinePayment: this.gateway.configured,
      reservationHours: reservationHours(reservation),
    }
  }

  private async catalogMap(): Promise<CatalogMap> {
    const published = { status: ProductStatus.PUBLISHED, deletedAt: null }
    const [categories, tags, brands] = await Promise.all([
      this.prisma.category.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          slug: true,
          name: true,
          parent: { select: { name: true } },
          _count: { select: { products: { where: published } } },
          children: {
            where: { deletedAt: null, isActive: true },
            select: { _count: { select: { products: { where: published } } } },
          },
        },
      }),
      this.prisma.tag.findMany({
        where: { deletedAt: null, products: { some: { product: published } } },
        orderBy: { name: 'asc' },
        select: { slug: true, name: true },
      }),
      this.prisma.brand.findMany({
        where: { deletedAt: null, isActive: true, products: { some: published } },
        orderBy: { name: 'asc' },
        select: { name: true },
      }),
    ])
    return {
      categories: categories.map(category => ({
        slug: category.slug,
        name: category.name,
        parent: category.parent?.name ?? null,
        // A parent category's search includes its subcategories, so its count does too.
        products: category._count.products + category.children.reduce((sum, child) => sum + child._count.products, 0),
      })),
      uses: tags,
      brands: brands.map(brand => brand.name),
    }
  }
}
