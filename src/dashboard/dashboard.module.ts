import { Module } from '@nestjs/common'
import { AdminDashboardController } from './admin-dashboard.controller'
import { DashboardService } from './dashboard.service'

/** Admin home metrics. Read-only aggregates over orders, products and frequent-customer applications. */
@Module({
  controllers: [AdminDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
