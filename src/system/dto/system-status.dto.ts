import type { CodeVersion, MachineUsage } from '../lib/system-runtime'

/**
 * `GET /admin/system`: how the API, its database, the integrations, the scheduled tasks and the store's data are doing,
 * for the developers' "Sistema" page. Never carries secrets: only whether each one is set and, for Mercado Pago, the
 * kind of credentials.
 */
export interface SystemStatusDto {
  checkedAt: string
  /** NODE_ENV of the API ("production" on the server). */
  environment: string
  api: {
    version: CodeVersion | null
    startedAt: string
    uptimeSeconds: number
    node: string
    machine: MachineUsage
    /** The disk of the uploaded files. */
    disk: { path: string; totalBytes: number; freeBytes: number } | null
  }
  database: {
    /** One trivial query, in milliseconds. */
    latencyMs: number
    /** Null when the build has no `prisma/migrations` folder to compare with. */
    migrations: { total: number; pending: string[] } | null
  }
  integrations: SystemIntegrationsDto
  /** Errors and warnings the API kept (`GET /admin/system/logs`). */
  logs: {
    /** Of the last 24 hours, repeats included. */
    last24h: { errors: number; warnings: number }
    lastError: { at: string; source: string; message: string } | null
  }
  jobs: {
    orderExpiry: {
      /** Every minute; null if it never ran against this database. */
      lastRunAt: string | null
      /** The last run could not release every overdue order. */
      failed: boolean
      /** Orders the job released in the last 24 hours. */
      expiredLast24h: number
      /** Unpaid orders whose reservation ended more than 2 minutes ago and are still holding stock. */
      overdue: number
    }
  }
  store: {
    /** The dollar rate in use (last one loaded). */
    exchangeRate: { rate: string; effectiveFrom: string } | null
    publishedWithoutImages: number
    publishedOutOfStock: number
    /** Orders waiting for their payment. */
    awaitingPayment: number
  }
}

export interface SystemIntegrationsDto {
  mercadoPago: {
    configured: boolean
    /** Kind of access token: TEST- (sandbox) or APP_USR- (production, or a test user's). */
    credentials: 'TEST' | 'APP_USR' | 'OTHER' | null
    webhookSecret: boolean
    notificationUrl: string | null
    lastNotificationAt: string | null
    /** Payment notifications that could not be processed in the last 30 days. */
    failedNotifications: { count: number; lastAt: string | null; lastError: string | null }
  }
  zipnova: {
    configured: boolean
    webhookSecret: boolean
    /** Host of the API it calls, to tell the sandbox from production. */
    apiHost: string | null
    lastQuoteAt: string | null
    lastShipmentAt: string | null
  }
  openai: {
    configured: boolean
    model: string
    reasoningEffort: string
    /** Tokens of the Argentine day so far, against the daily limit that pauses the assistant. */
    tokensToday: number
    dailyTokenLimit: number
    whatsappNumber: boolean
  }
  email: {
    /** No provider yet (TODO(mail)): emails are only recorded. */
    provider: null
    /** Emails of the last 30 days by what happened to them. */
    last30Days: { failed: number; logged: number; sent: number }
    lastAt: string | null
  }
}
