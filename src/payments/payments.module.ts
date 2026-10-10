import { Module } from '@nestjs/common'
import { MercadoPagoModule } from '../mercado-pago/mercado-pago.module'
import { OrdersModule } from '../orders/orders.module'
import { MercadoPagoCheckoutService } from './mercado-pago-checkout.service'
import { OrderPaymentsController } from './order-payments.controller'
import { PaymentNotificationsService } from './payment-notifications.service'
import { PaymentSyncService } from './payment-sync.service'
import { PaymentWebhooksController } from './payment-webhooks.controller'

/** Online payment of orders: the buyer's Mercado Pago checkout and return, and Mercado Pago's webhook. */
@Module({
  imports: [OrdersModule, MercadoPagoModule],
  controllers: [OrderPaymentsController, PaymentWebhooksController],
  providers: [MercadoPagoCheckoutService, PaymentNotificationsService, PaymentSyncService],
})
export class PaymentsModule {}
