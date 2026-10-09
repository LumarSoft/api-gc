/** How the store hands the parcel over, so staff know what to do once the label is printed. */
export type DispatchMode = 'CARRIER_BRANCH' | 'PROVIDER_HUB' | 'PICKUP'

/**
 * From the provider's dispatch code stored with the shipment (Zipnova `logistic_type`): take it to a carrier branch,
 * take it to Zipnova's distribution center, or wait for the pickup. Unknown codes return null (no instruction shown).
 */
export function dispatchMode(logisticType: string | null): DispatchMode | null {
  switch (logisticType) {
    case 'carrier_dropoff':
      return 'CARRIER_BRANCH'
    case 'xd_dropoff':
      return 'PROVIDER_HUB'
    case 'crossdock':
      return 'PICKUP'
    default:
      return null
  }
}
