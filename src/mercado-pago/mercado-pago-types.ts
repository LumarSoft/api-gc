/**
 * The parts of Mercado Pago's answers we read. Only used inside this folder: other modules see `payment-gateway.ts`.
 * Fields are optional because nothing in a provider answer is guaranteed.
 */
export interface MercadoPagoPreference {
  id?: string
  init_point?: string
  sandbox_init_point?: string
}

export interface MercadoPagoPayment {
  id?: number
  status?: string
  status_detail?: string | null
  external_reference?: string | null
  transaction_amount?: number
  currency_id?: string
  installments?: number | null
  date_approved?: string | null
}

export interface MercadoPagoPaymentSearch {
  results?: MercadoPagoPayment[]
}
