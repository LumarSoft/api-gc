import { createHash } from 'node:crypto'
import type { CarrierItem } from '../shipping-carrier'

/** How long a buyer can use a quote before quoting again (prices and branches can change). */
export const QUOTE_TTL_MINUTES = 30
/** The provider packs unit by unit, so the request carries one item per unit; this keeps it a sane size. */
export const MAX_QUOTED_UNITS = 1000

export interface ShippableVariant {
  id: number
  sku: string
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
}

export interface ShippableLine {
  variantId: number
  quantity: number
}

/**
 * Why a cart cannot be quoted. Publishing a product requires weight and measurements, so a missing one only happens
 * with data edited after publishing or products published before that rule.
 */
export type ShippabilityIssue = 'MISSING_MEASUREMENTS' | 'TOO_MANY_UNITS'

export const SHIPPABILITY_MESSAGES: Record<ShippabilityIssue, string> = {
  MISSING_MEASUREMENTS:
    'Algunos productos de tu carrito todavía no tienen envío al resto del país. Podés retirarlos en el local.',
  TOO_MANY_UNITS: 'El envío se cotiza hasta 1.000 unidades por pedido. Dividí la compra en varios pedidos.',
}

/** Weight and the three sides, all above zero: what the carrier needs to quote a unit. */
export function hasShippingData(variant: {
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
}): boolean {
  return [variant.weightGrams, variant.lengthMm, variant.widthMm, variant.heightMm].every(
    value => value !== null && value > 0,
  )
}

/** Identifies what was quoted; prices are left out because they do not change what is shipped. */
export function itemsHash(lines: ShippableLine[]): string {
  const sorted = [...lines].sort((a, b) => a.variantId - b.variantId).map(line => [line.variantId, line.quantity])
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

/** Null when every line can be quoted; `carrierItems` may only be called then. */
export function shippabilityIssue(lines: ShippableLine[], variants: ShippableVariant[]): ShippabilityIssue | null {
  if (lines.reduce((units, line) => units + line.quantity, 0) > MAX_QUOTED_UNITS) return 'TOO_MANY_UNITS'
  const measured = lines.every(line => {
    const variant = variants.find(candidate => candidate.id === line.variantId)
    return Boolean(variant && hasShippingData(variant))
  })
  return measured ? null : 'MISSING_MEASUREMENTS'
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
