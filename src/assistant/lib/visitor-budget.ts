/** Share of the store's daily tokens one visitor (an IP, an account) may use in a day. */
export const VISITOR_DAILY_SHARE = 0.1
/** New conversations one visitor may start per hour: each one starts the per-conversation limits from zero. */
export const VISITOR_CONVERSATIONS_PER_HOUR = 20
export const VISITOR_LIMIT_MESSAGE =
  'Llegamos al límite de consultas desde esta conexión por hoy. Probá de nuevo más tarde.'

const HOUR_MS = 3_600_000
/** Visitors remembered at once: under an attack from many IPs, the stalest are forgotten first. */
const MAX_VISITORS = 10_000

interface VisitorUsage {
  day: string
  tokens: number
  /** When the conversations of the last hour started. */
  starts: number[]
}

/**
 * Tokens each visitor used today and the conversations they started in the last hour, so one visitor (or a script
 * that opens a new conversation per message) cannot spend the store's whole daily limit. A visitor is several keys
 * (their IP and, when signed in, their account): any key over its budget stops them. In memory, like the other
 * assistant limits (one API instance); a restart forgives what was used.
 */
export class VisitorBudget {
  private readonly visitors = new Map<string, VisitorUsage>()
  private readonly dailyTokens: number

  constructor(storeDailyTokens: number) {
    this.dailyTokens = Math.floor(storeDailyTokens * VISITOR_DAILY_SHARE)
  }

  /** Whether the visitor may send a message now; `starting`: it opens a new conversation. */
  allows(keys: string[], starting: boolean, day: string, now: number): boolean {
    return keys.every(key => {
      const usage = this.usage(key, day, now)
      if (usage.tokens >= this.dailyTokens) return false
      return !starting || usage.starts.length < VISITOR_CONVERSATIONS_PER_HOUR
    })
  }

  started(keys: string[], day: string, now: number): void {
    for (const key of keys) this.usage(key, day, now).starts.push(now)
  }

  spent(keys: string[], tokens: number, day: string, now: number): void {
    for (const key of keys) this.usage(key, day, now).tokens += tokens
  }

  private usage(key: string, day: string, now: number): VisitorUsage {
    let usage = this.visitors.get(key)
    if (!usage) {
      this.forgetStalest()
      usage = { day, tokens: 0, starts: [] }
      this.visitors.set(key, usage)
    }
    if (usage.day !== day) Object.assign(usage, { day, tokens: 0 })
    usage.starts = usage.starts.filter(start => now - start < HOUR_MS)
    // Used again: last in the map's order, the one `forgetStalest` reads.
    this.visitors.delete(key)
    this.visitors.set(key, usage)
    return usage
  }

  private forgetStalest(): void {
    while (this.visitors.size >= MAX_VISITORS) {
      const stalest = this.visitors.keys().next()
      if (stalest.done) return
      this.visitors.delete(stalest.value)
    }
  }
}

/** The keys a visitor is counted under: their IP, and their account when signed in. */
export function visitorKeys(ip: string | undefined, userId: number | undefined): string[] {
  return [`ip:${ip ?? 'unknown'}`, ...(userId ? [`user:${userId}`] : [])]
}
