import { createHash } from 'node:crypto'
import type { CarrierItem } from '../shipping-carrier'

/** How long a buyer can use a quote before quoting again (prices and branches can change). */
export const QUOTE_TTL_MINUTES = 30
/** The provider packs unit by unit; larger orders are shipped by arrangement (and keep the request small). */
export const MAX_QUOTED_UNITS = 100

export interface ShippableVariant {
  id: number
  sku: string
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  isBulky: boolean
}

export interface ShippableLine {
  variantId: number
  quantity: number
}

/** Why a cart cannot be quoted. Bulky items and items without measurements are shipped by arrangement. */
export type ShippabilityIssue = 'BULKY' | 'MISSING_MEASUREMENTS' | 'TOO_MANY_UNITS'

export const SHIPPABILITY_MESSAGES: Record<ShippabilityIssue, string> = {
  BULKY: 'Tu carrito tiene equipos que enviamos a coordinar. Escribinos y te pasamos el costo.',
  MISSING_MEASUREMENTS: 'Todavía no podemos cotizar el envío de algunos productos. Escribinos y te pasamos el costo.',
  TOO_MANY_UNITS: 'Para pedidos de tantas unidades coordinamos el envío. Escribinos y te pasamos el costo.',
}

/** Identifies what was quoted; prices are left out because they do not change what is shipped. */
export function itemsHash(lines: ShippableLine[]): string {
  const sorted = [...lines].sort((a, b) => a.variantId - b.variantId).map(line => [line.variantId, line.quantity])
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

/** Null when every line can be quoted; `carrierItems` may only be called then. */
export function shippabilityIssue(lines: ShippableLine[], variants: ShippableVariant[]): ShippabilityIssue | null {
  const lineVariants = lines.map(line => variants.find(variant => variant.id === line.variantId))
  if (lineVariants.some(variant => variant?.isBulky)) return 'BULKY'
  if (lines.reduce((units, line) => units + line.quantity, 0) > MAX_QUOTED_UNITS) return 'TOO_MANY_UNITS'
  const measured = (variant: ShippableVariant | undefined): boolean =>
    Boolean(variant) &&
    [variant!.weightGrams, variant!.lengthMm, variant!.widthMm, variant!.heightMm].every(value => value && value > 0)
  return lineVariants.every(measured) ? null : 'MISSING_MEASUREMENTS'
}

/**
 * One carrier item per unit, so the provider can pack them. Millimeters become whole centimeters, rounded up. The
 * description printed on the label is the SKU: staff recognize it, and the box does not announce what is inside.
 */
export function carrierItems(lines: ShippableLine[], variants: ShippableVariant[]): CarrierItem[] {
  const cm = (mm: number | null): number => Math.max(1, Math.ceil((mm ?? 0) / 10))
  return lines.flatMap(line => {
    const variant = variants.find(candidate => candidate.id === line.variantId)!
    const item: CarrierItem = {
      sku: variant.sku,
      description: variant.sku,
      weightGrams: variant.weightGrams ?? 0,
      heightCm: cm(variant.heightMm),
      widthCm: cm(variant.widthMm),
      lengthCm: cm(variant.lengthMm),
    }
    return Array.from({ length: line.quantity }, () => item)
  })
}

/** Compares a typed destination with the quoted one, ignoring accents, case and extra spaces. */
export function sameDestination(
  a: { postalCode: string; city: string; province: string },
  b: { postalCode: string; city: string; province: string },
): boolean {
  const normalize = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  return (
    normalize(a.postalCode) === normalize(b.postalCode) &&
    normalize(a.city) === normalize(b.city) &&
    normalize(a.province) === normalize(b.province)
  )
}
