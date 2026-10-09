import { Module } from '@nestjs/common'
import { CartModule } from '../cart/cart.module'
import { PricingModule } from '../pricing/pricing.module'
import { ShippingModule } from '../shipping/shipping.module'
import { OrdersService } from './orders.service'
import { OrdersController } from './orders.controller'
import { AdminOrdersController } from './admin-orders.controller'
import { AdminOrdersService } from './admin-orders.service'
import { OrderMapper } from './order.mapper'
import { OrderStockService } from './order-stock.service'
import { OrderStatusService } from './order-status.service'
import { OrderExpiryService } from './order-expiry.service'
import { CustomerOrdersController } from './customer-orders.controller'
import { CustomerOrdersService } from './customer-orders.service'

@Module({
  imports: [CartModule, PricingModule, ShippingModule],
  providers: [
    OrdersService,
    AdminOrdersService,
    OrderMapper,
    OrderStockService,
    OrderStatusService,
    OrderExpiryService,
    CustomerOrdersService,
  ],
  controllers: [CustomerOrdersController, OrdersController, AdminOrdersController],
  exports: [OrdersService, AdminOrdersService, OrderStatusService],
})
export class OrdersModule {}
