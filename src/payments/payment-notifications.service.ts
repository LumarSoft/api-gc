import { Inject, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { NotificationStatus, PaymentProvider } from '../generated/prisma/enums'
import {
  PAYMENT_GATEWAY,
  PaymentGatewayError,
  type GatewayWebhookRequest,
  type PaymentGateway,
} from '../mercado-pago/payment-gateway'
import { PrismaService } from '../prisma/prisma.service'
import { PaymentSyncService } from './payment-sync.service'

/**
 * Mercado Pago webhook. Each signed notification is stored once (`PaymentNotification`); the payment it names is read
 * from Mercado Pago and recorded on its order. Processing is one API read and one transaction, so it runs before
 * answering: a failure answers 503 and Mercado Pago sends the notification again (for up to a day), which retries it.
 */
@Injectable()
export class PaymentNotificationsService {
  private readonly logger = new Logger(PaymentNotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly payments: PaymentSyncService,
  ) {}

  async notify(request: GatewayWebhookRequest): Promise<void> {
    const notification = this.gateway.readNotification(request)
    if (notification === 'UNAUTHORIZED') throw new UnauthorizedException()
    if (notification === 'IGNORED') return
    const key = { provider: PaymentProvider.MERCADO_PAGO, externalId: notification.notificationId }
    if (!(await this.claim(key, notification.topic, notification.paymentId))) return
    try {
      const payment = await this.gateway.getPayment(notification.paymentId)
      const ours = await this.payments.record(payment)
      await this.finish(key, ours ? NotificationStatus.PROCESSED : NotificationStatus.IGNORED, null)
    } catch (error) {
      // Mercado Pago's own test notifications name payments that do not exist: nothing to retry.
      if (error instanceof PaymentGatewayError && error.kind === 'NOT_FOUND')
        return this.finish(key, NotificationStatus.IGNORED, 'Payment not found at Mercado Pago')
      const reason = error instanceof PaymentGatewayError ? `Mercado Pago ${error.kind}` : 'Could not record payment'
      this.logger.warn(`Mercado Pago notification ${notification.notificationId} failed: ${reason}`)
      await this.finish(key, NotificationStatus.FAILED, reason)
      throw new ServiceUnavailableException()
    }
  }

  /** Stores the notification; false when it was already handled (a repeated delivery). Failed ones run again. */
  private async claim(
    key: { provider: PaymentProvider; externalId: string },
    topic: string,
    resourceId: string,
  ): Promise<boolean> {
    const saved = await this.prisma.paymentNotification.findUnique({
      where: { provider_externalId: key },
      select: { status: true },
    })
    if (saved) return saved.status === NotificationStatus.FAILED || saved.status === NotificationStatus.RECEIVED
    try {
      await this.prisma.paymentNotification.create({ data: { ...key, topic, resourceId }, select: { id: true } })
      return true
    } catch (error) {
      // The same notification arriving twice at once: the other delivery processes it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
      throw error
    }
  }

  private async finish(
    key: { provider: PaymentProvider; externalId: string },
    status: NotificationStatus,
    error: string | null,
  ): Promise<void> {
    await this.prisma.paymentNotification.update({
      where: { provider_externalId: key },
      data: { status, error, processedAt: status === NotificationStatus.FAILED ? null : new Date() },
      select: { id: true },
    })
  }
}
