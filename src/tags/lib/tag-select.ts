import type { AdminTagResponseDto } from '../dto/tag-response.dto'

export const TAG_SELECT = { id: true, name: true, slug: true, group: true } as const

export const ADMIN_TAG_SELECT = {
  ...TAG_SELECT,
  _count: { select: { products: { where: { product: { deletedAt: null } } } } },
} as const

export const TAG_ORDER = [{ group: 'asc' as const }, { name: 'asc' as const }]

export function toAdminTag(row: {
  id: number
  name: string
  slug: string
  group: string | null
  _count: { products: number }
}): AdminTagResponseDto {
  return { id: row.id, name: row.name, slug: row.slug, group: row.group, productCount: row._count.products }
}
