import { Transform } from 'class-transformer'
import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from './password.constraints'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

export class RegisterDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(191)
  email: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: 'password must contain at least one letter and one number' })
  password: string

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean
}
