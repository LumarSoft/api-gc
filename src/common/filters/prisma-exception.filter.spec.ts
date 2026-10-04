import { ArgumentsHost, ConflictException, NotFoundException } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { Prisma } from '../../generated/prisma/client'
import { PrismaExceptionFilter } from './prisma-exception.filter'

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('db error', { code, clientVersion: 'test' })

describe('PrismaExceptionFilter', () => {
  const parentCatch = jest.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => undefined)
  const host = {} as ArgumentsHost
  const filter = new PrismaExceptionFilter()

  beforeEach(() => parentCatch.mockClear())

  it('answers 409 for a unique constraint and 404 for a missing record', () => {
    filter.catch(prismaError('P2002'), host)
    expect(parentCatch.mock.calls[0][0]).toBeInstanceOf(ConflictException)
    filter.catch(prismaError('P2025'), host)
    expect(parentCatch.mock.calls[1][0]).toBeInstanceOf(NotFoundException)
  })

  it('leaves any other database error to the default 500 handling', () => {
    const error = prismaError('P2003')
    filter.catch(error, host)
    expect(parentCatch.mock.calls[0][0]).toBe(error)
  })
})
