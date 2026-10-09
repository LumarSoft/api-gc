import { NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common'
import { CarrierError } from '../../shipping/shipping-carrier'

/** Turns a provider failure into the error staff see. The provider's own validation message helps them fix data. */
export function carrierFailure(error: unknown): never {
  if (!(error instanceof CarrierError)) throw error
  if (error.kind === 'REJECTED')
    throw new UnprocessableEntityException(`Zipnova rechazó la operación: ${error.message}`)
  if (error.kind === 'NOT_READY')
    throw new UnprocessableEntityException('Zipnova todavía no generó la documentación. Probá en unos minutos.')
  if (error.kind === 'NOT_FOUND') throw new NotFoundException('Zipnova no encuentra este envío.')
  throw new ServiceUnavailableException('Zipnova no responde. Probá de nuevo en unos minutos.')
}
