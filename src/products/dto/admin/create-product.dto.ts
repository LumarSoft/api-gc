import { IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'
import { SLUG_PATTERN } from '../../../common/utils/slug'

/** SKU of the default variant: letters, numbers, dots, dashes and underscores (Tango-style codes). */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** A new product starts as a draft with one default variant, so it is never left without a sellable SKU. */
export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string

  /** Generated from the name when missing. */
  @IsOptional()
  @IsString()
  @MaxLength(220)
  @Matches(SLUG_PATTERN)
  slug?: string

  @IsInt()
  @Min(1)
  categoryId: number

  @IsOptional()
  @IsInt()
  @Min(1)
  brandId?: number | null

  @IsString()
  @MaxLength(60)
  @Matches(SKU_PATTERN)
  sku: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string | null
}
