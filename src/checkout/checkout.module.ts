import { Module } from '@nestjs/common'
import { CartModule } from '../cart/cart.module'
import { CheckoutController } from './checkout.controller'
import { CheckoutService } from './checkout.service'

@Module({ imports: [CartModule], controllers: [CheckoutController], providers: [CheckoutService] })
export class CheckoutModule {}
