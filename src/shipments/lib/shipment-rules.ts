import { ShipmentStatus } from '../../generated/prisma/enums'
import { SHIPPABILITY_MESSAGES, carrierItems, shippabilityIssue } from '../../shipping/lib/shipping-rules'
import type { CarrierShipment, CarrierShipmentRequest } from '../../shipping/shipping-carrier'
import type { BookingOrder, SyncedShipment } from './shipment-selects'

/** Our reference for the provider: the order number, plus the attempt when it is booked again after a cancel. */
export function bookingReference(orderNumber: string, attempt: number): string {
  return attempt > 1 ? `${orderNumber}-${attempt}` : orderNumber
}

/** The provider request for an order's shipment, or why it cannot be booked. */
export function bookingRequest(order: BookingOrder, reference: string): CarrierShipmentRequest | { error: string } {
  const shipment = order.shipments[0]
  const address = order.addresses[0]
  const phone = address?.phone ?? order.contactPhone
  if (!shipment?.carrierId || !shipment.serviceType || !shipment.logisticType)
    return { error: 'Este pedido no tiene una opción de envío elegida.' }
  if (!address?.taxId || !phone || !address.street || !address.streetNumber)
    return { error: 'Faltan datos de quien recibe (dirección, DNI/CUIT o teléfono).' }
  if (!address.city || !address.province || !address.postalCode)
    return { error: 'Falta la localidad, la provincia o el código postal del envío.' }
  const lines = order.items.map(item => ({ variantId: item.variant.id, quantity: item.quantity }))
  const variants = order.items.map(item => item.variant)
  const issue = shippabilityIssue(lines, variants)
  if (issue) return { error: `${SHIPPABILITY_MESSAGES[issue]} Revisá el peso y las medidas de los productos.` }
  return {
    reference,
    declaredValue: order.subtotal.toFixed(2),
    items: carrierItems(lines, variants),
    carrierId: shipment.carrierId,
    serviceType: shipment.serviceType,
    logisticType: shipment.logisticType,
    pickupPointId: shipment.pickupPointId,
    recipient: {
      name: address.name,
      taxId: address.taxId,
      email: order.contactEmail,
      phone,
      street: address.street,
      streetNumber: address.streetNumber,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode,
    },
  }
}

const FINAL: ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RETURNED,
  ShipmentStatus.CANCELLED,
  ShipmentStatus.LOST,
]

/** A provider read older than what is stored (two notifications racing): a final state never goes back. */
export function staleShipmentStatus(current: ShipmentStatus, remote: ShipmentStatus): boolean {
  return FINAL.includes(current) && !FINAL.includes(remote)
}

const HANDED_OVER: ShipmentStatus[] = [
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.READY_FOR_PICKUP,
  ShipmentStatus.DELIVERED,
]

/** Columns to store from the provider's view of a shipment. Dates are set the first time a state is reached. */
export function syncedShipmentData(
  current: Pick<SyncedShipment, 'shippedAt' | 'deliveredAt'>,
  remote: CarrierShipment,
  now = new Date(),
) {
  return {
    externalId: remote.id,
    status: remote.status,
    carrierStatus: remote.statusLabel.slice(0, 100),
    ...(remote.carrier ? { carrier: remote.carrier.slice(0, 60) } : {}),
    trackingNumber: remote.trackingNumber?.slice(0, 100) ?? null,
    trackingUrl: remote.trackingUrl?.slice(0, 500) ?? null,
    ...(HANDED_OVER.includes(remote.status) && !current.shippedAt ? { shippedAt: now } : {}),
    ...(remote.status === ShipmentStatus.DELIVERED && !current.deliveredAt ? { deliveredAt: now } : {}),
  }
}
