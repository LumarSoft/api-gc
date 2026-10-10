import { Module } from '@nestjs/common'
import { CartModule } from '../cart/cart.module'
import { MercadoPagoModule } from '../mercado-pago/mercado-pago.module'
import { OrdersModule } from '../orders/orders.module'
import { ShippingModule } from '../shipping/shipping.module'
import { CheckoutController } from './checkout.controller'
import { CheckoutService } from './checkout.service'

@Module({
  imports: [CartModule, MercadoPagoModule, OrdersModule, ShippingModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
