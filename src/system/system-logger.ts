import { ConsoleLogger, Injectable } from '@nestjs/common'
import { SystemLogLevel } from '../generated/prisma/enums'
import { logCallParts, logText, recordsSource } from './lib/system-log-rules'
import { SystemLogRecorder } from './system-log-recorder.service'

/**
 * The API's logger (`main.ts`): prints as Nest's own does and also keeps every error and warning for the developers'
 * "Sistema" page, with the class that logged it. Code keeps using `new Logger(MyService.name)`.
 */
@Injectable()
export class SystemLogger extends ConsoleLogger {
  constructor(private readonly recorder: SystemLogRecorder) {
    super()
  }

  override error(message: unknown, ...params: unknown[]): void {
    super.error(message, ...params)
    this.keep(SystemLogLevel.ERROR, message, params)
  }

  override warn(message: unknown, ...params: unknown[]): void {
    super.warn(message, ...params)
    this.keep(SystemLogLevel.WARN, message, params)
  }

  private keep(level: SystemLogLevel, message: unknown, params: unknown[]): void {
    const { source, stack } = logCallParts(params, this.context ?? 'API')
    if (recordsSource(source)) this.recorder.record({ level, source, ...logText(message, stack) })
  }
}
