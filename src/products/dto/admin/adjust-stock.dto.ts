import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/** Provisional manual stock count (until stock comes from Tango). */
export class AdjustStockDto {
  /** Physical units counted. */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  onHand: number

  /** "Pocas unidades" from this available quantity down; null = store default (3). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  lowStockThreshold?: number | null

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string | null
}
