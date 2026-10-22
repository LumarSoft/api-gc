import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { assistantLimits, whatsappNumber } from '../assistant/lib/assistant-limits'
import { openAiSettings } from '../assistant/openai/openai-assistant.model'
import { argentineDay, argentineMidnight } from '../common/utils/report-period'
import { EmailStatus, MessageRole, NotificationStatus, PaymentProvider } from '../generated/prisma/enums'
import { PAYMENT_GATEWAY, type PaymentGateway } from '../mercado-pago/payment-gateway'
import { PrismaService } from '../prisma/prisma.service'
import { SHIPPING_CARRIER, type ShippingCarrier } from '../shipping/shipping-carrier'
import type { SystemIntegrationsDto } from './dto/system-status.dto'

const DAY_MS = 24 * 60 * 60 * 1000

/** What each external provider is set up with and when it was last used. Reads settings, never shows a secret. */
@Injectable()
export class SystemIntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(SHIPPING_CARRIER) private readonly carrier: ShippingCarrier,
  ) {}

  async status(now = new Date()): Promise<SystemIntegrationsDto> {
    const [mercadoPago, zipnova, openai, email] = await Promise.all([
      this.mercadoPago(now),
      this.zipnova(),
      this.openai(now),
      this.email(now),
    ])
    return { mercadoPago, zipnova, openai, email }
  }

  private async mercadoPago(now: Date): Promise<SystemIntegrationsDto['mercadoPago']> {
    const token = this.setting('MERCADO_PAGO_ACCESS_TOKEN')
    const since = new Date(now.getTime() - 30 * DAY_MS)
    const where = { provider: PaymentProvider.MERCADO_PAGO }
    const [last, failed, lastFailed] = await Promise.all([
      this.prisma.paymentNotification.findFirst({ where, orderBy: { id: 'desc' }, select: { createdAt: true } }),
      this.prisma.paymentNotification.count({
        where: { ...where, status: NotificationStatus.FAILED, createdAt: { gte: since } },
      }),
      this.prisma.paymentNotification.findFirst({
        where: { ...where, status: NotificationStatus.FAILED },
        orderBy: { id: 'desc' },
        select: { createdAt: true, error: true },
      }),
    ])
    return {
      configured: this.gateway.configured,
      credentials: !token
        ? null
        : token.startsWith('TEST-')
          ? 'TEST'
          : token.startsWith('APP_USR-')
            ? 'APP_USR'
            : 'OTHER',
      webhookSecret: Boolean(this.setting('MERCADO_PAGO_WEBHOOK_SECRET')),
      notificationUrl: this.setting('MERCADO_PAGO_NOTIFICATION_URL'),
      lastNotificationAt: last?.createdAt.toISOString() ?? null,
      failedNotifications: {
        count: failed,
        lastAt: lastFailed?.createdAt.toISOString() ?? null,
        lastError: lastFailed?.error ?? null,
      },
    }
  }

  private async zipnova(): Promise<SystemIntegrationsDto['zipnova']> {
    const [quote, shipment] = await Promise.all([
      this.prisma.shippingQuote.findFirst({ orderBy: { id: 'desc' }, select: { createdAt: true } }),
      this.prisma.shipment.findFirst({
        where: { externalId: { not: null } },
        orderBy: { id: 'desc' },
        select: { createdAt: true },
      }),
    ])
    return {
      configured: this.carrier.configured,
      webhookSecret: Boolean(this.setting('ZIPNOVA_WEBHOOK_SECRET')),
      apiHost: host(this.setting('ZIPNOVA_API_URL')),
      lastQuoteAt: quote?.createdAt.toISOString() ?? null,
      lastShipmentAt: shipment?.createdAt.toISOString() ?? null,
    }
  }

  private async openai(now: Date): Promise<SystemIntegrationsDto['openai']> {
    const read = (key: string): string | undefined => this.config.get<string>(key)
    const totals = await this.prisma.assistantMessage.aggregate({
      where: { role: MessageRole.ASSISTANT, createdAt: { gte: new Date(argentineMidnight(argentineDay(now))) } },
      _sum: { inputTokens: true, outputTokens: true },
    })
    return {
      configured: Boolean(this.setting('OPENAI_API_KEY')),
      ...openAiSettings(read),
      tokensToday: (totals._sum.inputTokens ?? 0) + (totals._sum.outputTokens ?? 0),
      dailyTokenLimit: assistantLimits(read).dailyTokens,
      whatsappNumber: whatsappNumber(read('ASSISTANT_WHATSAPP_NUMBER')) !== null,
    }
  }

  private async email(now: Date): Promise<SystemIntegrationsDto['email']> {
    const since = new Date(now.getTime() - 30 * DAY_MS)
    const [byStatus, last] = await Promise.all([
      this.prisma.emailMessage.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.emailMessage.findFirst({ orderBy: { id: 'desc' }, select: { createdAt: true } }),
    ])
    const count = (status: EmailStatus): number => byStatus.find(row => row.status === status)?._count ?? 0
    return {
      provider: null,
      last30Days: {
        failed: count(EmailStatus.FAILED),
        logged: count(EmailStatus.LOGGED),
        sent: count(EmailStatus.SENT),
      },
      lastAt: last?.createdAt.toISOString() ?? null,
    }
  }

  /** A setting as written, or null when it is empty. Only for presence checks and public values. */
  private setting(key: string): string | null {
    return this.config.get<string>(key)?.trim() || null
  }
}

function host(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
