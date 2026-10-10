import { Module } from '@nestjs/common'
import { MercadoPagoClient } from './mercado-pago.client'
import { MercadoPagoGateway } from './mercado-pago.gateway'
import { PAYMENT_GATEWAY } from './payment-gateway'

/** Online payment provider integration (Mercado Pago Checkout Pro) behind `PAYMENT_GATEWAY`. */
@Module({
  providers: [MercadoPagoClient, { provide: PAYMENT_GATEWAY, useClass: MercadoPagoGateway }],
  exports: [PAYMENT_GATEWAY],
})
export class MercadoPagoModule {}
