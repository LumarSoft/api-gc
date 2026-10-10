import { Prisma } from '../../generated/prisma/client'
import { checkoutLines, type PayableOrder } from './checkout-lines'

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value)

describe('checkoutLines', () => {
  const order: PayableOrder = {
    number: 'CG-000123',
    total: decimal('42143.00'),
    shippingTotal: decimal('12143.00'),
    items: [
      { sku: 'T544', productName: 'Tinta T544', variantName: 'Negro', quantity: 2, unitPrice: decimal('15000.00') },
    ],
  }

  it('sends each product and the delivery when they add up to the total', () => {
    expect(checkoutLines(order)).toEqual([
      { id: 'T544', title: 'Tinta T544 — Negro', quantity: 2, unitPrice: '15000.00' },
      { id: 'envio', title: 'Envío', quantity: 1, unitPrice: '12143.00' },
    ])
  })

  it('leaves free delivery out', () => {
    expect(checkoutLines({ ...order, total: decimal('30000.00'), shippingTotal: decimal('0') })).toHaveLength(1)
  })

  it('falls back to one line with the order total when the lines do not add up', () => {
    expect(checkoutLines({ ...order, total: decimal('40000.00') })).toEqual([
      { id: 'CG-000123', title: 'Pedido CG-000123', quantity: 1, unitPrice: '40000.00' },
    ])
  })
})
