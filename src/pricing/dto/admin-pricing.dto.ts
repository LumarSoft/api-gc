import { Type } from 'class-transformer'
import { IsDateString, IsDecimal, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import { BuyerType, Currency, DataSource } from '../../generated/prisma/enums'

export class PriceListDto {
  id: number
  code: string
  name: string
  audience: BuyerType
  isDefault: boolean
}

export class ExchangeRateDto {
  id: number
  currency: Currency
  /** ARS per 1 unit of `currency`, decimal string with 4 decimals. */
  rate: string
  source: DataSource
  effectiveFrom: Date
  createdAt: Date
}

export class ExchangeRatesResponseDto {
  /** The rate used right now for USD prices, or null when none was loaded. */
  current: ExchangeRateDto | null
  /** Rates loaded for a future moment, oldest first. */
  scheduled: ExchangeRateDto[]
  /** Latest rates first (current and past). */
  history: ExchangeRateDto[]
}

export class ListExchangeRatesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20
}

export class CreateExchangeRateDto {
  @IsIn([Currency.USD])
  currency: Currency = Currency.USD

  /** ARS per USD, decimal string with up to 4 decimals, e.g. "1450.50". */
  @IsDecimal({ decimal_digits: '0,4' })
  rate: string

  /** When it starts to apply; default now. Never in the past: history is append-only. */
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string
}
