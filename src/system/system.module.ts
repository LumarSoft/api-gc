import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { MercadoPagoModule } from '../mercado-pago/mercado-pago.module'
import { ShippingModule } from '../shipping/shipping.module'
import { AdminSystemController } from './admin-system.controller'
import { AdminSystemService } from './admin-system.service'
import { RequestErrorsInterceptor } from './request-errors.interceptor'
import { SystemActivityService } from './system-activity.service'
import { SystemIntegrationsService } from './system-integrations.service'
import { SystemLogPurgeService } from './system-log-purge.service'
import { SystemLogRecorder } from './system-log-recorder.service'
import { SystemLogger } from './system-logger'
import { SystemLogsService } from './system-logs.service'

/**
 * The developers' view of the system: API, database, integrations, scheduled tasks and the store's data, plus the
 * API's errors and warnings (`SystemLogger` in main.ts, `RequestErrorsInterceptor` for every request) and what staff
 * changed in the admin.
 */
@Module({
  imports: [MercadoPagoModule, ShippingModule],
  controllers: [AdminSystemController],
  providers: [
    AdminSystemService,
    SystemIntegrationsService,
    SystemLogsService,
    SystemActivityService,
    SystemLogRecorder,
    SystemLogger,
    SystemLogPurgeService,
    { provide: APP_INTERCEPTOR, useClass: RequestErrorsInterceptor },
  ],
  exports: [SystemLogger],
})
export class SystemModule {}
