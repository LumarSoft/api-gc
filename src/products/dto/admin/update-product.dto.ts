import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { SLUG_PATTERN } from '../../../common/utils/slug'
import { OutOfStockBehavior } from '../../../generated/prisma/enums'

/** General product data. Status, images, specifications, tags and variants have their own endpoints. */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(220)
  @Matches(SLUG_PATTERN)
  slug?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  brandId?: number | null

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  description?: string | null

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean

  @IsOptional()
  @IsIn(Object.values(OutOfStockBehavior))
  outOfStockBehavior?: OutOfStockBehavior

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  warrantyMonths?: number | null

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(160)
  seoDescription?: string | null
}
