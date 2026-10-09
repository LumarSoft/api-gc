import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Min } from 'class-validator'
import type { CarrierDocumentFormat, CarrierDocumentKind } from '../../shipping/shipping-carrier'

export class ShipmentDocumentParamsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number

  /** label: one per package. guide: the dispatch guide some carriers require (attach it to the invoice or remito). */
  @IsIn(['label', 'guide'])
  kind: CarrierDocumentKind
}

export class ShipmentDocumentQueryDto {
  /** zpl: for thermal label printers (labels only). */
  @IsOptional()
  @IsIn(['pdf', 'zpl'])
  format: CarrierDocumentFormat = 'pdf'
}
