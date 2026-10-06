import type { ProductSummaryDto } from '../../products/dto/product-response.dto'

export class FavoritesResponseDto {
  /** Newest first. Products that are no longer visible in the store are left out. */
  items: ProductSummaryDto[]
}
