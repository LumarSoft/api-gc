import { Prisma } from '../../generated/prisma/client'
import { localDeliveryProblem } from './settings-rules'

const decimal = (value: string) => new Prisma.Decimal(value)

describe('settings rules', () => {
  it('needs a rate to turn Rosario delivery on, but not to keep it off', () => {
    expect(localDeliveryProblem({ isActive: true, flatRate: null, freeShippingThreshold: null })).toMatch(/tarifa/)
    expect(localDeliveryProblem({ isActive: false, flatRate: null, freeShippingThreshold: null })).toBeNull()
    expect(localDeliveryProblem({ isActive: true, flatRate: decimal('0'), freeShippingThreshold: null })).toBeNull()
  })
  it('rejects a free-shipping amount of zero', () => {
    expect(
      localDeliveryProblem({ isActive: true, flatRate: decimal('3500'), freeShippingThreshold: decimal('0') }),
    ).toMatch(/mayor a cero/)
    expect(
      localDeliveryProblem({ isActive: true, flatRate: decimal('3500'), freeShippingThreshold: decimal('80000') }),
    ).toBeNull()
  })
})
