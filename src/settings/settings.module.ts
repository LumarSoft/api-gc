import { Module } from '@nestjs/common'
import { AuditLogsModule } from '../audit-logs/audit-logs.module'
import { AdminSettingsController } from './admin-settings.controller'
import { AdminSettingsService } from './admin-settings.service'

/** Admin store settings: Rosario delivery (ShippingMethod LOCAL_DELIVERY) and the reservation window (Setting). */
@Module({
  imports: [AuditLogsModule],
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService],
})
export class SettingsModule {}
