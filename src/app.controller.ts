import { Controller, Get } from '@nestjs/common'
import { AppService, HealthStatus } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth(): Promise<HealthStatus> {
    return this.appService.getHealth()
  }
}
