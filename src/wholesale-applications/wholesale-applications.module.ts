import { Module } from '@nestjs/common'
import { AuditLogsModule } from '../audit-logs/audit-logs.module'
import { AdminWholesaleApplicationsController } from './admin-wholesale-applications.controller'
import { AdminWholesaleApplicationsService } from './admin-wholesale-applications.service'
import { WholesaleApplicationMapper } from './wholesale-application.mapper'
import { WholesaleApplicationsController } from './wholesale-applications.controller'
import { WholesaleApplicationsService } from './wholesale-applications.service'

@Module({
  imports: [AuditLogsModule],
  controllers: [WholesaleApplicationsController, AdminWholesaleApplicationsController],
  providers: [WholesaleApplicationsService, AdminWholesaleApplicationsService, WholesaleApplicationMapper],
})
export class WholesaleApplicationsModule {}
