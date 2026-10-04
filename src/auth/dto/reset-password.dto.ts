import { IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from './password.constraints'

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token: string

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_PATTERN, { message: 'password must contain at least one letter and one number' })
  password: string
}
