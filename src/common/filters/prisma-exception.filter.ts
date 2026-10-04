import { ArgumentsHost, Catch, ConflictException, HttpException, NotFoundException } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { Prisma } from '../../generated/prisma/client'

/**
 * Turns the database errors a client can cause into proper HTTP answers instead of a 500:
 * - P2002 unique constraint (two admins saving the same slug/SKU at once, after the service already checked) → 409.
 * - P2025 record to update not found (archived meanwhile) → 404.
 * Everything else keeps Nest's default handling (500 without internal details).
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    super.catch(this.toHttp(error) ?? error, host)
  }

  private toHttp(error: Prisma.PrismaClientKnownRequestError): HttpException | null {
    if (error.code === 'P2002') return new ConflictException('A record with the same unique value already exists')
    if (error.code === 'P2025') return new NotFoundException('The record no longer exists')
    return null
  }
}
