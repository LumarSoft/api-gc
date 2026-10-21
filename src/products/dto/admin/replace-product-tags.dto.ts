import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../../../common/constants/database'

/** Every tag of the product; tags left out are unlinked. */
export class ReplaceProductTagsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_INT_ID, { each: true })
  tagIds: number[]
}
