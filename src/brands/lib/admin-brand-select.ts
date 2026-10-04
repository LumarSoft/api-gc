import type { AdminBrandResponseDto } from '../dto/admin-brand-response.dto'

export const ADMIN_BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoFileId: true,
  logoFile: { select: { storageKey: true } },
  sortOrder: true,
  isActive: true,
  _count: { select: { products: { where: { deletedAt: null } } } },
} as const

export interface AdminBrandRow {
  id: number
  name: string
  slug: string
  logoFileId: number | null
  logoFile: { storageKey: string } | null
  sortOrder: number
  isActive: boolean
  _count: { products: number }
}

export function toAdminBrand(row: AdminBrandRow, publicUrl: (storageKey: string) => string): AdminBrandResponseDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoFileId: row.logoFileId,
    logoUrl: row.logoFile ? publicUrl(row.logoFile.storageKey) : null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount: row._count.products,
  }
}
