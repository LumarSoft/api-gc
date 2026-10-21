import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { MAX_INT_ID } from '../../../common/constants/database'

export class SpecificationInputDto {
  /** Existing row; omit for a new one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  id?: number

  /** Section, e.g. "Impresión". */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupName?: string | null

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  value: string
}

/** The full, ordered technical sheet. Rows left out are removed. */
export class ReplaceProductSpecificationsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SpecificationInputDto)
  specifications: SpecificationInputDto[]
}
