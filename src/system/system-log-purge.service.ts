import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SYSTEM_LOG_DAYS } from './lib/system-log-rules'

const EVERY_MS = 6 * 60 * 60 * 1000

/** Deletes the errors and warnings older than 30 days: an operational log, not history (see database.md). */
@Injectable()
export class SystemLogPurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemLogPurgeService.name)
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.purge(), EVERY_MS)
    this.timer.unref()
    void this.purge()
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async purge(now = new Date()): Promise<number> {
    try {
      const cutoff = new Date(now.getTime() - SYSTEM_LOG_DAYS * 24 * 60 * 60 * 1000)
      const { count } = await this.prisma.systemLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
      return count
    } catch {
      this.logger.error('Could not delete old system log entries')
      return 0
    }
  }
}
