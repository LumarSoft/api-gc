import { Module } from '@nestjs/common'
import { PricingModule } from '../pricing/pricing.module'
import { CartController } from './cart.controller'
import { CartService } from './cart.service'
import { CartOwnerService } from './cart-owner.service'
import { CartMapper } from './cart.mapper'

@Module({
  imports: [PricingModule],
  controllers: [CartController],
  providers: [CartService, CartOwnerService, CartMapper],
  exports: [CartService],
})
export class CartModule {}
