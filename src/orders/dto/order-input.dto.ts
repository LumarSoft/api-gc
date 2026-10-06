import { Type } from 'class-transformer'
import { Equals, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { PreviewCheckoutDto } from '../../checkout/dto/checkout-input.dto'
import { OrderStatus } from '../../generated/prisma/enums'

export class PlaceOrderDto extends PreviewCheckoutDto {
  /** Generated with Web Crypto before sending the first request; reused on retries. */
  @Matches(/^[a-f0-9]{64}$/)
  accessToken: string

  @Matches(/^[a-f0-9]{64}$/)
  reviewToken: string
}

export class TrackOrderDto {
  @Matches(/^[a-f0-9]{64}$/)
  accessToken: string
}

export class OrderNumberDto {
  @Matches(/^CG-\d{6,10}$/)
  number: string
}

export class ListOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus
}

export class ChangeOrderStatusDto {
  @IsEnum(OrderStatus)
  status: OrderStatus

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string

  /** Required by the service only for manual payment confirmation. */
  @IsOptional()
  @Equals(true)
  paymentReceived?: boolean
}
