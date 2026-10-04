export class AdminBrandResponseDto {
  id: number
  name: string
  slug: string
  logoFileId: number | null
  logoUrl: string | null
  sortOrder: number
  isActive: boolean
  /** Products (any status, not archived) of this brand. */
  productCount: number
}
