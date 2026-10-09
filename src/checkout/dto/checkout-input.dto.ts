import { Transform, Type } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { DeliveryMethod } from '../../generated/prisma/enums'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

/** Where a carrier quote goes: enough to price it before the buyer types the street. */
export class ShippingDestinationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  postalCode: string
}

export class QuoteShippingDto {
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingDestinationDto)
  destination: ShippingDestinationDto
}

export class CheckoutAddressDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  street: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  streetNumber: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  province: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  postalCode: string

  /**
   * DNI (7–8 digits) or CUIT (11) of whoever receives the parcel; spaces, dots and dashes are dropped and an empty
   * value counts as absent. Carriers require it (CARRIER delivery); the CUIT check digit is checked with the rest.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/[\s.-]/g, '') || undefined : value,
  )
  @IsOptional()
  @Matches(/^(\d{7,8}|\d{11})$/, { message: 'taxId must be a DNI (7 or 8 digits) or a CUIT (11 digits)' })
  taxId?: string
}

export class PreviewCheckoutDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string

  @Transform(trim)
  @IsEmail()
  @MaxLength(191)
  email: string

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsEnum(DeliveryMethod)
  deliveryMethod: DeliveryMethod

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  shippingAddress?: CheckoutAddressDto

  /** Option chosen from `POST /cart/checkout/shipping-quotes` (CARRIER delivery). */
  @IsOptional()
  @IsInt()
  @Min(1)
  shippingQuoteId?: number
}
