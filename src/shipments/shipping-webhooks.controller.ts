import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ShipmentsService } from './shipments.service'

/**
 * Carrier provider notifications. Public on purpose: the provider cannot authenticate, so the URL carries a secret
 * (`ZIPNOVA_WEBHOOK_SECRET`). A wrong secret answers 404; a failed sync answers 503 so the provider retries.
 */
@Controller('shipping/webhooks')
export class ShippingWebhooksController {
  constructor(private readonly shipments: ShipmentsService) {}

  /**
   * The body is the provider's payload, read by the carrier adapter. It has no DTO on purpose: the global pipe would
   * reject fields the provider adds later (and the provider would retry forever), and nothing in it is trusted.
   */
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async notify(@Param('token') token: string, @Body() body: unknown): Promise<{ received: true }> {
    await this.shipments.notify(token, body)
    return { received: true }
  }
}
