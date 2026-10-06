import { Prisma } from '../../generated/prisma/client'

export function cartVariantSelect(priceListIds: number[]) {
  return {
    id: true,
    sku: true,
    name: true,
    isActive: true,
    deletedAt: true,
    product: {
      select: {
        name: true,
        slug: true,
        status: true,
        deletedAt: true,
        images: {
          where: { deletedAt: null, file: { deletedAt: null } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { file: { select: { storageKey: true } } },
        },
      },
    },
    inventory: { select: { onHand: true, reserved: true, deletedAt: true } },
    prices: {
      where: { deletedAt: null, priceListId: { in: priceListIds }, priceList: { deletedAt: null } },
      select: { priceListId: true, amount: true, currency: true, compareAtAmount: true },
    },
  } satisfies Prisma.ProductVariantSelect
}

export type CartVariantRow = Prisma.ProductVariantGetPayload<{ select: ReturnType<typeof cartVariantSelect> }>
