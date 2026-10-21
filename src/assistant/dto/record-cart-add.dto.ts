import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../../common/constants/database'

/** A product the customer added to the cart from one of the assistant's cards. */
export class RecordCartAddDto {
  /** Token of the conversation that showed the card. */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  conversation: string

  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  productId: number

  /** The variant the card added; absent when it added none directly. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  variantId?: number
}
