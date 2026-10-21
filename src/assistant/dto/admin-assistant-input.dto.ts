import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto'
import { ConversationStatus, QuestionStatus } from '../../generated/prisma/enums'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

/** Questions changed in one request: a page of the list. */
export const QUESTION_STATUS_MAX = 100

/** Conversations started within the days `from`–`to` (Argentine, both included); without them, every day. */
export class ListAssistantConversationsDto extends DateRangeQueryDto {
  /** Capped so an absurd page cannot overflow the database offset (500). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25

  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus

  /** Partial match on any message of the conversation and the customer's name or email; "#12" or "12" also its id. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string
}

export class ListUnansweredQuestionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25

  @IsOptional()
  @IsEnum(QuestionStatus)
  status?: QuestionStatus

  /** Partial match on the question. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string
}

/** Marks one or several questions answered or dismissed, or opens them again. */
export class ChangeQuestionStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(QUESTION_STATUS_MAX)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids: number[]

  @IsEnum(QuestionStatus)
  status: QuestionStatus
}
