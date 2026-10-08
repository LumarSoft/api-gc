import { Module } from '@nestjs/common'
import { AdminAnalyticsController } from './admin-analytics.controller'
import { AnalyticsMapper } from './analytics.mapper'
import { AnalyticsService } from './analytics.service'

/** Admin stats page ("Estadísticas"). Read-only aggregates over orders, products and customers. */
@Module({
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsService, AnalyticsMapper],
})
export class AnalyticsModule {}
