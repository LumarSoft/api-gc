import { Module } from '@nestjs/common'
import { MercadoPagoModule } from '../mercado-pago/mercado-pago.module'
import { ShippingModule } from '../shipping/shipping.module'
import { AdminSystemController } from './admin-system.controller'
import { AdminSystemService } from './admin-system.service'
import { SystemIntegrationsService } from './system-integrations.service'

/** The developers' view of the system: API, database, integrations, scheduled tasks and the store's data. Read-only. */
@Module({
  imports: [MercadoPagoModule, ShippingModule],
  controllers: [AdminSystemController],
  providers: [AdminSystemService, SystemIntegrationsService],
})
export class SystemModule {}
