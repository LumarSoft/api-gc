import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export const PRODUCT_SORTS = ['relevance', 'newest', 'price-asc', 'price-desc', 'name'] as const
export type ProductSort = (typeof PRODUCT_SORTS)[number]

export const MAX_PAGE_SIZE = 48

const SLUG_PATTERN = /^[a-z0-9-]+$/

/** "a,b,c" → ["a", "b", "c"]. Lets the front keep filters in a readable URL. */
const toSlugList = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(slug => slug.trim())
        .filter(Boolean)
    : value

export class ListProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 24

  /** Category slug. Includes its subcategories. */
  @IsOptional()
  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(120)
  category?: string

  /** Comma-separated brand slugs. */
  @IsOptional()
  @Transform(toSlugList)
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(SLUG_PATTERN, { each: true })
  brand?: string[]

  /** Comma-separated tag slugs (any of them). */
  @IsOptional()
  @Transform(toSlugList)
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(SLUG_PATTERN, { each: true })
  tag?: string[]

  /** Free text: name, short description or SKU. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  featured?: boolean

  /** `true` = only products shown as offers (lowest price for this buyer below its previous price). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  onSale?: boolean

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: ProductSort = 'relevance'
}
