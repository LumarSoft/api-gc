import { Module } from '@nestjs/common'
import { ActivityController } from './activity.controller'
import { ActivityService } from './activity.service'
import { PopularSearchesService } from './popular-searches.service'

/**
 * Anonymous store activity (visits, product views, searches, cart and checkout steps) for the stats page, and the
 * searches most visitors make, for the store's search box.
 */
@Module({
  controllers: [ActivityController],
  providers: [ActivityService, PopularSearchesService],
})
export class ActivityModule {}
