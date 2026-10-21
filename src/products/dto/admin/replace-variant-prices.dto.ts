import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsDecimal, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator'
import { MAX_INT_ID } from '../../../common/constants/database'
import { Currency } from '../../../generated/prisma/enums'

const MONEY = { decimal_digits: '0,2', force_decimal: false } as const

export class VariantPriceInputDto {
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  priceListId: number

  /** Decimal string, up to 2 decimals: "419999" or "419999.90". */
  @IsDecimal(MONEY)
  amount: string

  @IsIn(Object.values(Currency))
  currency: Currency

  /** Previous price shown crossed out, same currency; must be higher than `amount`. */
  @IsOptional()
  @IsDecimal(MONEY)
  compareAtAmount?: string | null
}

/** Every price of the variant, one per price list. Lists left out lose their price. */
export class ReplaceVariantPricesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VariantPriceInputDto)
  prices: VariantPriceInputDto[]
}
