import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import { PaymentNotificationsService } from './payment-notifications.service'

/**
 * Mercado Pago notifications. Public on purpose: Mercado Pago signs them (`x-signature`, `MERCADO_PAGO_WEBHOOK_SECRET`)
 * instead of authenticating. A bad signature answers 401; a failed sync answers 503 so Mercado Pago retries.
 */
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly notifications: PaymentNotificationsService) {}

  /**
   * The body is Mercado Pago's payload, read by the gateway. It has no DTO on purpose: the global pipe would reject
   * fields Mercado Pago adds later (and it would retry forever), and nothing in it is trusted.
   */
  @Post('mercado-pago')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async notify(
    @Req() request: Request,
    @Headers('x-signature') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    const query = request.originalUrl.split('?')[1] ?? ''
    await this.notifications.notify({ signature, requestId, query, body })
    return { received: true }
  }
}
