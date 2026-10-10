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
  if (query.stock === 'out') filters.push(outOfStockWhere(reservedField))
  if (query.shipping === 'missing') filters.push(missingShippingDataWhere)
  if (query.q) {
    // `contains` becomes LIKE: escape % and _ so they are searched literally.
    const term = query.q.trim().replace(/[\\%_]/g, '\\$&')
    filters.push({
      OR: [{ name: { contains: term } }, { variants: { some: { sku: { contains: term }, deletedAt: null } } }],
    })
  }
  return { AND: filters }
}

/** Some active variant lacks weight or a measurement (null or zero), the same rule as `hasShippingData`. */
const missingShippingDataWhere: Prisma.ProductWhereInput = {
  variants: {
    some: {
      deletedAt: null,
      isActive: true,
      OR: (['weightGrams', 'lengthMm', 'widthMm', 'heightMm'] as const).flatMap(field => [
        { [field]: null },
        { [field]: { lte: 0 } },
      ]),
    },
  },
}

/** No active variant has stock left once reservations are taken out. Shared by the list and the admin home. */
export function outOfStockWhere(reservedField: Prisma.FieldRef<'InventoryLevel', 'Int'>): Prisma.ProductWhereInput {
  return {
    variants: {
      none: { deletedAt: null, isActive: true, inventory: { is: { onHand: { gt: reservedField } } } },
    },
  }
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
