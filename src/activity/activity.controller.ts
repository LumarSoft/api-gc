import { Body, Controller, Get, Header, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ActivityService } from './activity.service'
import type { PopularSearchesDto } from './dto/popular-searches.dto'
import { RecordActivityDto } from './dto/record-activity.dto'
import { PopularSearchesService } from './popular-searches.service'

@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly popular: PopularSearchesService,
  ) {}

  /** Public: the store's browser reports what an anonymous visitor did. Called from the browser, never the server. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  record(@Body() event: RecordActivityDto, @Headers('user-agent') userAgent?: string): Promise<void> {
    return this.activity.record(event, userAgent)
  }

  /** Public: what visitors search for most, for the store's search box (called from the browser when it opens). */
  @Get('popular-searches')
  @Header('Cache-Control', 'public, max-age=600')
  popularSearches(): Promise<PopularSearchesDto> {
    return this.popular.list()
  }
}
