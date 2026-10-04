import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { SLUG_PATTERN } from '../../common/utils/slug'

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  /** Generated from the group and the name when missing ("uso-hogar"). Used in catalog filter URLs. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(SLUG_PATTERN)
  slug?: string

  /** Filter group, lowercase, e.g. "uso". Null for loose tags. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(SLUG_PATTERN)
  group?: string | null
}
