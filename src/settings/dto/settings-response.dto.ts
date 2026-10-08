import type { MoneyDto } from '../../pricing/pricing.service'

export interface AdminSettingsDto {
  localDelivery: {
    isActive: boolean
    /** ARS; null until staff set it. */
    flatRate: MoneyDto | null
    freeShippingThreshold: MoneyDto | null
  }
  reservation: {
    manualHours: number
    /** No stored value: checkout uses the default. */
    isDefault: boolean
  }
}
