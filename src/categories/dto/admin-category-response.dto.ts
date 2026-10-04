export class AdminCategoryResponseDto {
  id: number
  parentId: number | null
  name: string
  slug: string
  description: string | null
  imageFileId: number | null
  imageUrl: string | null
  sortOrder: number
  isActive: boolean
  /** Products (any status, not archived) directly in this category. */
  productCount: number
  children: AdminCategoryResponseDto[]
}
