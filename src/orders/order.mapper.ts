import { Injectable } from '@nestjs/common'
import { FilesService } from '../files/files.service'
import { AddressType } from '../generated/prisma/enums'
import type { OrderResponseDto } from './dto/order-response.dto'
import { dispatchMode } from '../shipping/lib/dispatch-mode'
import { orderTransitions, shipmentActions } from './lib/order-rules'
import type { AdminOrderRow, OrderRow } from './lib/order-selects'

@Injectable()
export class OrderMapper {
  constructor(private readonly files: FilesService) {}

  response(row: OrderRow, admin = false): OrderResponseDto {
    const money = (value: { toFixed: (places: number) => string }) => ({
      amount: value.toFixed(2),
      currency: row.currency,
    })
    const shipping = row.addresses.find(address => address.type === AddressType.SHIPPING)
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      deliveryMethod: row.deliveryMethod,
      paymentMethod: row.paymentMethod,
      subtotal: money(row.subtotal),
      shippingTotal: money(row.shippingTotal),
      total: money(row.total),
      placedAt: row.placedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      customer: { name: row.addresses[0]?.name ?? '', email: row.contactEmail, phone: row.contactPhone },
      shippingAddress: shipping
        ? {
            street: shipping.street,
            streetNumber: shipping.streetNumber,
            city: shipping.city,
            province: shipping.province,
            postalCode: shipping.postalCode,
          }
        : null,
      items: row.items.map(item => {
        const image = item.variant.product.images[0]
        return {
          name: item.productName,
          variantName: item.variantName,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: money(item.unitPrice),
          total: money(item.lineTotal),
          imageUrl: image ? this.files.publicUrl(image.file.storageKey) : null,
        }
      }),
      shipment: row.shipments[0]
        ? {
            status: row.shipments[0].status,
            carrier: row.shipments[0].carrier,
            service: row.shipments[0].service,
            carrierStatus: row.shipments[0].carrierStatus,
            trackingNumber: row.shipments[0].trackingNumber,
            trackingUrl: row.shipments[0].trackingUrl,
            pickupPoint: row.shipments[0].pickupPoint,
          }
        : null,
      history: row.statusHistory.map(event => ({ status: event.toStatus, at: event.createdAt.toISOString() })),
      ...(admin
        ? {
            allowedStatuses: orderTransitions(row.status, row.deliveryMethod).filter(
              status => !(status === 'CONFIRMED' && row.expiresAt && row.expiresAt <= new Date()),
            ),
          }
        : {}),
    }
  }

  /** Staff view: the public shape plus next states, history notes and authors, and the guest flag. */
  adminResponse(row: AdminOrderRow): OrderResponseDto {
    const response = this.response(row, true)
    const shipment = row.shipments[0]
    return {
      ...response,
      shipment:
        response.shipment && shipment
          ? {
              ...response.shipment,
              actions: shipmentActions(row.status, shipment),
              dispatch: dispatchMode(shipment.logisticType),
            }
          : null,
      guest: row.userId === null,
      history: row.statusHistory.map(event => ({
        status: event.toStatus,
        at: event.createdAt.toISOString(),
        note: event.note,
        by: event.changedBy ? `${event.changedBy.firstName} ${event.changedBy.lastName}`.trim() : null,
      })),
    }
  }
}
