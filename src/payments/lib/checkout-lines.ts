import { Prisma } from '../../generated/prisma/client'
import type { CheckoutLine } from '../../mercado-pago/payment-gateway'

export interface PayableOrder {
  number: string
  total: Prisma.Decimal
  shippingTotal: Prisma.Decimal
  items: { sku: string; productName: string; variantName: string | null; quantity: number; unitPrice: Prisma.Decimal }[]
}

/**
 * What the buyer pays at Mercado Pago, from the order snapshot: one line per product plus the delivery. When the
 * lines would not add up to the order total exactly (a discount, a rounding), a single line with the total is sent
 * instead, so the provider always charges what the order says.
 */
export function checkoutLines(order: PayableOrder): CheckoutLine[] {
  const lines: CheckoutLine[] = order.items.map(item => ({
    id: item.sku,
    title: (item.variantName ? `${item.productName} — ${item.variantName}` : item.productName).slice(0, 250),
    quantity: item.quantity,
    unitPrice: item.unitPrice.toFixed(2),
  }))
  if (order.shippingTotal.gt(0))
    lines.push({ id: 'envio', title: 'Envío', quantity: 1, unitPrice: order.shippingTotal.toFixed(2) })
  const sum = lines.reduce(
    (total, line) => total.plus(new Prisma.Decimal(line.unitPrice).times(line.quantity)),
    new Prisma.Decimal(0),
  )
  if (lines.length && sum.equals(order.total)) return lines
  return [{ id: order.number, title: `Pedido ${order.number}`, quantity: 1, unitPrice: order.total.toFixed(2) }]
}
