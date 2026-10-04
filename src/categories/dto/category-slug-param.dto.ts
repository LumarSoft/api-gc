import { IsString, Matches, MaxLength } from 'class-validator'

export class CategorySlugParamDto {
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9-]+$/)
  slug: string
}
