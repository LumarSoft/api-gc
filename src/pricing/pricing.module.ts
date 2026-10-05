import { Module } from '@nestjs/common'
import { AdminExchangeRatesService } from './admin-exchange-rates.service'
import { AdminPricingController } from './admin-pricing.controller'
import { PricingService } from './pricing.service'

/** Shared price resolution (price lists, buyer profile, USD conversion) used by catalog, cart and orders. */
@Module({
  controllers: [AdminPricingController],
  providers: [PricingService, AdminExchangeRatesService],
  exports: [PricingService],
})
export class PricingModule {}
