import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import { Prisma } from '../generated/prisma/client'
import { ReservationStatus, StockBucket, StockMovementReason } from '../generated/prisma/enums'

@Injectable()
export class OrderStockService {
  async lock(tx: Prisma.TransactionClient, variantIds: number[]): Promise<void> {
    for (const id of [...new Set(variantIds)].sort((a, b) => a - b)) {
      await tx.$queryRaw`SELECT id FROM InventoryLevel WHERE variantId = ${id} FOR UPDATE`
    }
  }

  async reserve(
    tx: Prisma.TransactionClient,
    orderId: number,
    items: { variantId: number; quantity: number }[],
    expiresAt: Date,
  ): Promise<void> {
    for (const item of items) {
      const level = await tx.inventoryLevel.findUnique({
        where: { variantId: item.variantId },
        select: { onHand: true, reserved: true, deletedAt: true },
      })
      if (!level || level.deletedAt || level.onHand - level.reserved < item.quantity)
        throw new UnprocessableEntityException('El stock cambió. Revisá tu carrito antes de confirmar.')
      await tx.inventoryLevel.update({
        where: { variantId: item.variantId },
        data: { reserved: { increment: item.quantity } },
      })
      await tx.stockReservation.create({ data: { ...item, orderId, expiresAt } })
      await tx.stockMovement.create({
        data: { ...item, orderId, bucket: StockBucket.RESERVED, reason: StockMovementReason.RESERVATION },
      })
    }
  }

  async resolve(
    tx: Prisma.TransactionClient,
    orderId: number,
    status: ReservationStatus,
    actorId?: number,
  ): Promise<void> {
    const items = await tx.stockReservation.findMany({
      where: { orderId, status: ReservationStatus.ACTIVE, deletedAt: null },
      select: { id: true, variantId: true, quantity: true },
      orderBy: { variantId: 'asc' },
    })
    await this.lock(
      tx,
      items.map(item => item.variantId),
    )
    for (const item of items) {
      const level = await tx.inventoryLevel.findUniqueOrThrow({
        where: { variantId: item.variantId },
        select: { onHand: true, reserved: true },
      })
      const consumed = status === ReservationStatus.CONSUMED
      if (level.reserved < item.quantity || (consumed && level.onHand < item.quantity))
        throw new UnprocessableEntityException('La reserva de stock requiere revisión del equipo.')
      await tx.inventoryLevel.update({
        where: { variantId: item.variantId },
        data: { reserved: { decrement: item.quantity }, ...(consumed ? { onHand: { decrement: item.quantity } } : {}) },
      })
      await tx.stockReservation.update({ where: { id: item.id }, data: { status, resolvedAt: new Date() } })
      await tx.stockMovement.create({
        data: {
          variantId: item.variantId,
          orderId,
          quantity: -item.quantity,
          bucket: StockBucket.RESERVED,
          reason: StockMovementReason.RESERVATION_RELEASE,
          createdById: actorId,
        },
      })
      if (consumed)
        await tx.stockMovement.create({
          data: {
            variantId: item.variantId,
            orderId,
            quantity: -item.quantity,
            bucket: StockBucket.ON_HAND,
            reason: StockMovementReason.SALE,
            createdById: actorId,
          },
        })
    }
  }
}
