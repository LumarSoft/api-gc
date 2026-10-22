import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { SystemLogLevel } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { LogText } from './lib/system-log-rules'

/** Entries are written in batches: a burst of the same error becomes one row with its count. */
const FLUSH_MS = 5000
/** Distinct entries per batch; past it they are counted as dropped, so a flood cannot fill the database. */
const MAX_PER_BATCH = 50

export type SystemLogEntry = LogText & { level: SystemLogLevel; source: string; route?: string | null }
type Pending = SystemLogEntry & { count: number; createdAt: Date; lastSeenAt: Date }

/**
 * Keeps the API's errors and warnings in `SystemLog` for the developers' page. Never throws and never logs through
 * Nest (that would record its own failures in a loop): its own problems go to stderr.
 */
@Injectable()
export class SystemLogRecorder implements OnModuleDestroy {
  private pending = new Map<string, Pending>()
  private dropped = 0
  private readonly timer = setInterval(() => void this.flush(), FLUSH_MS)

  constructor(private readonly prisma: PrismaService) {
    this.timer.unref()
  }

  record(entry: SystemLogEntry): void {
    const key = [entry.level, entry.source, entry.route ?? '', entry.message].join('\u0000')
    const now = new Date()
    const known = this.pending.get(key)
    if (known) {
      known.count += 1
      known.lastSeenAt = now
    } else if (this.pending.size >= MAX_PER_BATCH) {
      this.dropped += 1
    } else {
      this.pending.set(key, { ...entry, count: 1, createdAt: now, lastSeenAt: now })
    }
  }

  async flush(): Promise<void> {
    const entries = [...this.pending.values()]
    const dropped = this.dropped
    this.pending = new Map()
    this.dropped = 0
    if (dropped > 0) {
      const now = new Date()
      entries.push({
        level: SystemLogLevel.WARN,
        source: 'SystemLog',
        message: `${dropped} registros más no se guardaron: llegaron demasiados juntos.`,
        stack: null,
        count: dropped,
        createdAt: now,
        lastSeenAt: now,
      })
    }
    if (!entries.length) return
    try {
      await this.prisma.systemLog.createMany({
        data: entries.map(entry => ({
          level: entry.level,
          source: entry.source.slice(0, 100),
          route: entry.route ?? null,
          message: entry.message,
          stack: entry.stack,
          count: entry.count,
          createdAt: entry.createdAt,
          lastSeenAt: entry.lastSeenAt,
        })),
      })
    } catch (error) {
      process.stderr.write(`SystemLog: could not save ${entries.length} entries (${String(error)})\n`)
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer)
    await this.flush()
  }
}
