import { Injectable } from '@nestjs/common'
import { AddressType } from '../generated/prisma/enums'
import type { OrderResponseDto } from './dto/order-response.dto'
import { orderTransitions } from './lib/order-rules'
import type { OrderRow } from './lib/order-selects'

@Injectable()
export class OrderMapper {
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
      items: row.items.map(item => ({
        name: item.productName,
        variantName: item.variantName,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: money(item.unitPrice),
        total: money(item.lineTotal),
      })),
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
}
