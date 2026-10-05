import { Prisma } from '../../generated/prisma/client'
import type { AdminProductSort, ListAdminProductsQueryDto } from '../dto/admin/list-admin-products-query.dto'

/**
 * Filters of the admin product list. Archived products never appear. `reservedField` is the Prisma field reference
 * of InventoryLevel.reserved, needed to compare on-hand against reserved stock in the database.
 */
export function adminProductsWhere(
  query: ListAdminProductsQueryDto,
  reservedField: Prisma.FieldRef<'InventoryLevel', 'Int'>,
): Prisma.ProductWhereInput {
  const filters: Prisma.ProductWhereInput[] = [{ deletedAt: null }]
  if (query.status) filters.push({ status: query.status })
  if (query.categoryId) {
    filters.push({ OR: [{ categoryId: query.categoryId }, { category: { parentId: query.categoryId } }] })
  }
  if (query.brandId) filters.push({ brandId: query.brandId })
  if (query.stock === 'out') {
    filters.push({
      variants: {
        none: { deletedAt: null, isActive: true, inventory: { is: { onHand: { gt: reservedField } } } },
      },
    })
  }
  if (query.q) {
    // `contains` becomes LIKE: escape % and _ so they are searched literally.
    const term = query.q.trim().replace(/[\\%_]/g, '\\$&')
    filters.push({
      OR: [{ name: { contains: term } }, { variants: { some: { sku: { contains: term }, deletedAt: null } } }],
    })
  }
  return { AND: filters }
}

export function adminProductsOrderBy(sort: AdminProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ name: 'asc' }, { id: 'asc' }]
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'desc' }]
    default:
      return [{ updatedAt: 'desc' }, { id: 'desc' }]
  }
}
