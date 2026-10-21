import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export const MAX_MESSAGE_LENGTH = 1000

export class SendAssistantMessageDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  message: string

  /** Token the API returned when the conversation started. Absent = start a new conversation. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  conversation?: string

  /** Product page the customer is on, so the assistant knows what "this one" is. */
  @IsOptional()
  @IsString()
  @MaxLength(220)
  @Matches(/^[a-z0-9-]+$/)
  productSlug?: string
}
