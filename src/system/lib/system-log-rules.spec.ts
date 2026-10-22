import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { Prisma } from '../../generated/prisma/client'
import { isServerError, logCallParts, logText, requestRoute } from './system-log-rules'

const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('db', { code, clientVersion: 'test' })

describe('system log rules', () => {
  it('keeps the failures on our side, not the client errors', () => {
    expect(isServerError(new Error('bug'))).toBe(true)
    expect(isServerError(new ServiceUnavailableException())).toBe(true)
    expect(isServerError(new BadRequestException())).toBe(false)
    expect(isServerError(prismaError('P2002'))).toBe(false)
    expect(isServerError(prismaError('P2003'))).toBe(true)
  })

  it('reads the class and the stack of a Nest logger call', () => {
    expect(logCallParts(['MercadoPagoClient'], 'API')).toEqual({ source: 'MercadoPagoClient', stack: null })
    expect(logCallParts(['Error: x\n    at a', 'ExceptionsHandler'], 'API')).toEqual({
      source: 'ExceptionsHandler',
      stack: 'Error: x\n    at a',
    })
    expect(logCallParts([], 'API')).toEqual({ source: 'API', stack: null })
  })

  it('cuts messages and stacks to a sane size', () => {
    const error = new Error('x'.repeat(5000))
    const text = logText(error)
    expect(text.message).toHaveLength(2000)
    expect(text.stack?.split('\n').length).toBeLessThanOrEqual(12)
    expect(logText({ code: 1 })).toEqual({ message: '{"code":1}', stack: null })
  })

  it('names a request by its route pattern', () => {
    expect(requestRoute('GET', '/orders/:number')).toBe('GET /orders/:number')
    expect(requestRoute('POST', undefined)).toBe('POST (ruta desconocida)')
  })
})
