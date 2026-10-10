import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { ProductStatus } from '../../../generated/prisma/enums'

export const ADMIN_PRODUCT_SORTS = ['updated', 'name', 'newest'] as const
export type AdminProductSort = (typeof ADMIN_PRODUCT_SORTS)[number]

export const MAX_ADMIN_PAGE_SIZE = 100

export class ListAdminProductsQueryDto {
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
  @Max(MAX_ADMIN_PAGE_SIZE)
  pageSize: number = 25

  /** Name or SKU. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string

  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status?: ProductStatus

  /** Includes its subcategories. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  brandId?: number

  /** `out`: no active variant with available stock. */
  @IsOptional()
  @IsIn(['out'])
  stock?: 'out'

  /** `missing`: an active variant has no weight or measurements (cannot be published nor shipped by carrier). */
  @IsOptional()
  @IsIn(['missing'])
  shipping?: 'missing'

  @IsOptional()
  @IsIn(ADMIN_PRODUCT_SORTS)
  sort: AdminProductSort = 'updated'
}
