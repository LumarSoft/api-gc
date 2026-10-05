import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator'

export class ProductImageInputDto {
  /** Existing image row; omit for a new one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  id?: number

  /** Id returned by POST /admin/files/images. */
  @IsInt()
  @Min(1)
  fileId: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string | null

  /** Variant this photo shows (e.g. an ink color); must belong to the product. */
  @IsOptional()
  @IsInt()
  @Min(1)
  variantId?: number | null
}

/** The full, ordered gallery: the first image is the main one. Images left out are removed from the product. */
export class ReplaceProductImagesDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProductImageInputDto)
  images: ProductImageInputDto[]
}
