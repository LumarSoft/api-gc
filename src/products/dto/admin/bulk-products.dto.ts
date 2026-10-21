import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, Max, Min } from 'class-validator'
import { MAX_INT_ID } from '../../../common/constants/database'
import type { ProductIssue } from '../../lib/admin-product-rules'
import {
  BULK_PRODUCT_ACTIONS,
  BULK_PRODUCTS_MAX,
  type BulkProductAction,
  type BulkSkipReason,
} from '../../lib/bulk-product-rules'

export class BulkProductsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_PRODUCTS_MAX)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(MAX_INT_ID, { each: true })
  ids: number[]

  @IsIn(BULK_PRODUCT_ACTIONS)
  action: BulkProductAction
}

export interface BulkProductsResultDto {
  /** Products whose status changed (or that were archived). */
  updated: number[]
  /** Already in the requested status. */
  unchanged: number[]
  skipped: { id: number; reason: BulkSkipReason; issues?: ProductIssue[] }[]
}
