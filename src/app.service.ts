import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'

export interface HealthStatus {
  status: 'ok'
  database: 'up'
}

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      throw new ServiceUnavailableException('Database is not reachable')
    }
    return { status: 'ok', database: 'up' }
  }
}
