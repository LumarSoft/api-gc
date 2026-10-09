import { Module } from '@nestjs/common'
import { SHIPPING_CARRIER } from './shipping-carrier'
import { ShippingQuotesService } from './shipping-quotes.service'
import { ZipnovaCarrier } from './zipnova/zipnova.carrier'
import { ZipnovaClient } from './zipnova/zipnova.client'

/** Carrier provider integration (Zipnova) behind `SHIPPING_CARRIER`, plus carrier quotes for carts. */
@Module({
  providers: [ZipnovaClient, { provide: SHIPPING_CARRIER, useClass: ZipnovaCarrier }, ShippingQuotesService],
  exports: [SHIPPING_CARRIER, ShippingQuotesService],
})
export class ShippingModule {}
