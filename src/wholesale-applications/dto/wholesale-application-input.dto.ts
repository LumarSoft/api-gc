import { Transform, Type } from 'class-transformer'
import { IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import { WholesaleStatus } from '../../generated/prisma/enums'
import { normalizeCuit } from '../lib/cuit'
import { APPLICANT_TAX_CONDITIONS } from '../lib/wholesale-rules'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)
const trimOrNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value

export class CreateWholesaleApplicationDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName: string

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  tradeName?: string

  /** Dashes and spaces allowed; the check digit is validated by the service. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeCuit(value) : value))
  @IsString()
  @MaxLength(13)
  cuit: string

  @IsIn(APPLICANT_TAX_CONDITIONS)
  taxCondition: (typeof APPLICANT_TAX_CONDITIONS)[number]

  @Transform(trim)
  @IsEmail()
  @MaxLength(191)
  email: string

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  phone?: string

  /** What the business does, what it usually buys. Read by the team when reviewing. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  message?: string
}

export class ListWholesaleApplicationsDto {
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
  @IsEnum(WholesaleStatus)
  status?: WholesaleStatus

  /** Legal or trade name, CUIT (with or without dashes), company email or applicant name/email (partial). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string
}

export class WholesaleDecisionDto {
  /** Shown to the customer (rejection or pause reason). Required to reject or pause. */
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  note?: string
}
