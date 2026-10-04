export class TagResponseDto {
  id: number
  name: string
  slug: string
  /** Filter group, e.g. "uso". Null for loose tags. */
  group: string | null
}

export class AdminTagResponseDto extends TagResponseDto {
  /** Products (any status, not archived) with this tag. */
  productCount: number
}
