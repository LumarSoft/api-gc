import { Transform, Type } from 'class-transformer'
import { Equals, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { PreviewCheckoutDto } from '../../checkout/dto/checkout-input.dto'
import { OrderStatus } from '../../generated/prisma/enums'
import { ORDER_STAGE_NAMES, type OrderStage } from '../lib/order-rules'

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

/** Pagination of the customer's own orders (account area). */
export class ListMyOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 10
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

  /** A group of states (list views); combined with `status` when both are sent. */
  @IsOptional()
  @IsIn(ORDER_STAGE_NAMES)
  stage?: OrderStage

  /** Order number, customer name or email (partial). */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string
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
