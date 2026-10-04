import { Global, Module } from '@nestjs/common'
import { AuditLogsService } from './audit-logs.service'

/** Global: every admin feature module records its changes here. */
@Global()
@Module({
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
