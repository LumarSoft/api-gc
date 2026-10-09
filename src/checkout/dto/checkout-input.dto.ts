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

  /** DNI or CUIT of whoever receives the parcel, digits only. Carriers require it (CARRIER delivery). */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value))
  @IsOptional()
  @Matches(/^\d{7,11}$/, { message: 'taxId must be a DNI or CUIT (7 to 11 digits)' })
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
