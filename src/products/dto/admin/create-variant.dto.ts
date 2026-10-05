import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { SaleUnit } from '../../../generated/prisma/enums'
import { SKU_PATTERN } from './create-product.dto'

export class CreateVariantDto {
  @IsString()
  @MaxLength(60)
  @Matches(SKU_PATTERN)
  sku: string

  /** Label when the product has several variants, e.g. "Cyan 70 ml". */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string | null

  /** Option values, e.g. { "Color": "Cyan" }: up to 5 options, names ≤50 and values ≤100 characters. */
  @IsOptional()
  @IsObject()
  optionValues?: Record<string, string> | null

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string | null

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @IsIn(Object.values(SaleUnit))
  saleUnit?: SaleUnit

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  unitsPerSaleUnit?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  weightGrams?: number | null

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  lengthMm?: number | null

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  widthMm?: number | null

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  heightMm?: number | null

  @IsOptional()
  @IsBoolean()
  isBulky?: boolean
}
