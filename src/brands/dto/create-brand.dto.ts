import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator'
import { SLUG_PATTERN } from '../../common/utils/slug'

export class CreateBrandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  /** Generated from the name when missing. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN)
  slug?: string

  /** Id returned by POST /admin/files/images. Null removes the logo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  logoFileId?: number | null

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
