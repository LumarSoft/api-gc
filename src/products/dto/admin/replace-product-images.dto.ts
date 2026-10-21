import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { MAX_INT_ID } from '../../../common/constants/database'

export class ProductImageInputDto {
  /** Existing image row; omit for a new one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  id?: number

  /** Id returned by POST /admin/files/images. */
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
  fileId: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string | null

  /** Variant this photo shows (e.g. an ink color); must belong to the product. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INT_ID)
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
