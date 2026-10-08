import { IsBoolean, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator'
import { RESERVATION_HOURS_MAX } from '../lib/settings-rules'

/** Non-negative ARS amount, up to 10 integer digits and 2 decimals ("3500", "3500.50"). */
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/

export class UpdateLocalDeliveryDto {
  @IsBoolean()
  isActive: boolean

  /** Flat rate in ARS; required to turn delivery on. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(AMOUNT)
  flatRate?: string | null

  /** Order subtotal from which delivery is free; null = never free. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(AMOUNT)
  freeShippingThreshold?: string | null
}

export class UpdateReservationDto {
  @IsInt()
  @Min(1)
  @Max(RESERVATION_HOURS_MAX)
  manualHours: number
}
