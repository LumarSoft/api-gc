import { Transform } from 'class-transformer'
import { IsString, MaxLength, MinLength } from 'class-validator'

export class SuggestProductsQueryDto {
  /** What the customer has typed so far. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q: string
}
