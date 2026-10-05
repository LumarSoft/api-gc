import { Transform, Type } from 'class-transformer'
import { IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { DeliveryMethod } from '../../generated/prisma/enums'

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value)

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
}
