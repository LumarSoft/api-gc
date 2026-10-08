import { ActivityType } from '../../generated/prisma/enums'

/** Events about one product: they must name it. */
export const PRODUCT_EVENTS: ActivityType[] = [ActivityType.PRODUCT_VIEW, ActivityType.ADD_TO_CART]

/** Crawlers, link previews and headless browsers that run the store's JavaScript: not visitors. */
const BOT_USER_AGENT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse|pingdom/i

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || BOT_USER_AGENT.test(userAgent)
}

/** "  Tinta   EPSON " → "tinta epson": the same search typed differently counts once. */
export function normalizeSearch(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 100)
}
