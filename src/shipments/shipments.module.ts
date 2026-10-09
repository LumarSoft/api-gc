import { Module } from '@nestjs/common'
import { OrdersModule } from '../orders/orders.module'
import { ShippingModule } from '../shipping/shipping.module'
import { AdminShipmentsController } from './admin-shipments.controller'
import { ShipmentsService } from './shipments.service'
import { ShippingWebhooksController } from './shipping-webhooks.controller'

/** Carrier shipments of orders: staff operations and the provider's status notifications. */
@Module({
  imports: [OrdersModule, ShippingModule],
  controllers: [AdminShipmentsController, ShippingWebhooksController],
  providers: [ShipmentsService],
})
export class ShipmentsModule {}
