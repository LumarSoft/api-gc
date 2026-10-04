import type { AdminCategoryResponseDto } from '../dto/admin-category-response.dto'

export const ADMIN_CATEGORY_SELECT = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  imageFileId: true,
  imageFile: { select: { storageKey: true } },
  sortOrder: true,
  isActive: true,
  _count: { select: { products: { where: { deletedAt: null } } } },
} as const

export interface AdminCategoryRow {
  id: number
  parentId: number | null
  name: string
  slug: string
  description: string | null
  imageFileId: number | null
  imageFile: { storageKey: string } | null
  sortOrder: number
  isActive: boolean
  _count: { products: number }
}

/** Builds the two-level tree from rows already sorted by sortOrder. Orphans (archived parent) are listed at the top. */
export function buildCategoryTree(
  rows: AdminCategoryRow[],
  publicUrl: (storageKey: string) => string,
): AdminCategoryResponseDto[] {
  const toDto = (row: AdminCategoryRow): AdminCategoryResponseDto => ({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageFileId: row.imageFileId,
    imageUrl: row.imageFile ? publicUrl(row.imageFile.storageKey) : null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount: row._count.products,
    children: [],
  })

  const byId = new Map(rows.map(row => [row.id, toDto(row)]))
  const roots: AdminCategoryResponseDto[] = []
  for (const node of byId.values()) {
    const parent = node.parentId === null ? undefined : byId.get(node.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
