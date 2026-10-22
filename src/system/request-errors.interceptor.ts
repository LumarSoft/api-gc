import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import type { Request } from 'express'
import { catchError, type Observable, throwError } from 'rxjs'
import { SystemLogLevel } from '../generated/prisma/enums'
import { isServerError, logText, requestRoute } from './lib/system-log-rules'
import { SystemLogRecorder } from './system-log-recorder.service'

/** Every request that ends in a 5xx (or an unexpected error) is kept with its route, for the developers' page. */
@Injectable()
export class RequestErrorsInterceptor implements NestInterceptor {
  constructor(private readonly recorder: SystemLogRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (context.getType() === 'http' && isServerError(error)) {
          const request = context.switchToHttp().getRequest<Request>()
          const route = (request.route as { path?: string } | undefined)?.path
          this.recorder.record({
            level: SystemLogLevel.ERROR,
            source: 'HTTP',
            route: requestRoute(request.method, route),
            ...logText(error),
          })
        }
        return throwError(() => error)
      }),
    )
  }
}
