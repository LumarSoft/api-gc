import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ActivityService } from './activity.service'
import { RecordActivityDto } from './dto/record-activity.dto'

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** Public: the store's browser reports what an anonymous visitor did. Called from the browser, never the server. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  record(@Body() event: RecordActivityDto, @Headers('user-agent') userAgent?: string): Promise<void> {
    return this.activity.record(event, userAgent)
  }
}
