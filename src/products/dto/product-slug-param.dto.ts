import { IsString, Matches, MaxLength } from 'class-validator'

export class ProductSlugParamDto {
  @IsString()
  @MaxLength(220)
  @Matches(/^[a-z0-9-]+$/)
  slug: string
}
