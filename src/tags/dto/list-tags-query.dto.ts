import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { SLUG_PATTERN } from '../../common/utils/slug'

export class ListTagsQueryDto {
  /** Only tags of this group, e.g. "uso". */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @Matches(SLUG_PATTERN)
  group?: string
}
