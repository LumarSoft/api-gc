export class CategorySummaryDto {
  id: number
  name: string
  slug: string
}

export class CategoryResponseDto extends CategorySummaryDto {
  description: string | null
  imageUrl: string | null
  /** Set for subcategories, so the front can build breadcrumbs. */
  parent: CategorySummaryDto | null
  children: CategorySummaryDto[]
}
