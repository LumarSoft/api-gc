import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Min } from 'class-validator'

/** Every tag of the product; tags left out are unlinked. */
export class ReplaceProductTagsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  tagIds: number[]
}
