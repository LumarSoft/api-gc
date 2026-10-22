import { HttpException } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'

/** Database errors the API answers as 4xx (`PrismaExceptionFilter`): the client's doing, not a failure of ours. */
const MAPPED_PRISMA_CODES = ['P2002', 'P2025', 'P2034']
/** Nest logs unhandled request errors here; `RequestErrorsInterceptor` already records them, with their route. */
const SKIPPED_SOURCES = new Set(['ExceptionsHandler'])
const MAX_MESSAGE = 2000
const MAX_STACK_LINES = 12
const MAX_STACK = 4000

/** Days a recorded error or warning is kept. */
export const SYSTEM_LOG_DAYS = 30

export interface LogText {
  message: string
  stack: string | null
}

/** Whether a request error is ours to look at: a 5xx, or anything that is not an HTTP answer at all. */
export function isServerError(error: unknown): boolean {
  if (error instanceof HttpException) return error.getStatus() >= 500
  if (error instanceof Prisma.PrismaClientKnownRequestError) return !MAPPED_PRISMA_CODES.includes(error.code)
  return true
}

/** The message and the first lines of the stack of whatever was thrown or logged, cut to a sane size. */
export function logText(value: unknown, stack?: string | null): LogText {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : safeJson(value)
  const trace = stack ?? (value instanceof Error ? value.stack : null) ?? null
  return {
    message: message.slice(0, MAX_MESSAGE) || '(sin mensaje)',
    stack: trace ? trace.split('\n').slice(0, MAX_STACK_LINES).join('\n').slice(0, MAX_STACK) : null,
  }
}

/**
 * What a Nest logger call carries after the message: `[context]`, `[stack, context]` or nothing. The context is the
 * class that logged (`new Logger(MyService.name)`).
 */
export function logCallParts(params: unknown[], fallbackContext: string): { source: string; stack: string | null } {
  const strings = params.filter((param): param is string => typeof param === 'string')
  if (strings.length >= 2) return { source: strings[strings.length - 1], stack: strings[0] }
  return { source: strings[0] ?? fallbackContext, stack: null }
}

export const recordsSource = (source: string): boolean => !SKIPPED_SOURCES.has(source)

/** "POST /cart/checkout/orders": the route pattern, so ids and private tokens never reach the log. */
export function requestRoute(method: string, routePath: string | undefined): string {
  return `${method} ${routePath ?? '(ruta desconocida)'}`.slice(0, 191)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
