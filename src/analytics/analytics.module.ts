import { Module } from '@nestjs/common'
import { AdminAnalyticsController } from './admin-analytics.controller'
import { AnalyticsMapper } from './analytics.mapper'
import { AnalyticsService } from './analytics.service'
import { BehaviorAnalyticsService } from './behavior-analytics.service'

/** Admin stats page ("Estadísticas"). Read-only aggregates over orders, products, customers, activity and carts. */
@Module({
  controllers: [AdminAnalyticsController],
  providers: [AnalyticsService, BehaviorAnalyticsService, AnalyticsMapper],
})
export class AnalyticsModule {}
