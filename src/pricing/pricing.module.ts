import { Module } from '@nestjs/common'
import { PricingService } from './pricing.service'

/** Shared price resolution (price lists, buyer profile, USD conversion) used by catalog, cart and orders. */
@Module({
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
