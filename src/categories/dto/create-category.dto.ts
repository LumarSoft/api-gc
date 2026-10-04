import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'
import { SLUG_PATTERN } from '../../common/utils/slug'

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string

  /** Generated from the name when missing. Changing it changes the category's URL. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN)
  slug?: string

  /** Null or missing = top-level category. Must be a top-level category (two levels only). */
  @IsOptional()
  @IsInt()
  @Min(1)
  parentId?: number | null

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null

  /** Id returned by POST /admin/files/images. Null removes the image. */
  @IsOptional()
  @IsInt()
  @Min(1)
  imageFileId?: number | null

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
