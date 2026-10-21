import { Injectable } from '@nestjs/common'
import { ActivityType } from '../generated/prisma/enums'
import { PrismaService } from '../prisma/prisma.service'
import type { PopularSearchesDto } from './dto/popular-searches.dto'
import {
  isShareableSearch,
  POPULAR_SEARCH_DAYS,
  POPULAR_SEARCH_MIN_VISITORS,
  POPULAR_SEARCHES,
} from './lib/popular-searches-rules'

/** They change slowly; one read every few minutes serves every search box that opens. */
const CACHE_MS = 10 * 60_000

/**
 * What visitors search for most and find, for the store's search box: the last 30 days' searches with results, typed
 * by at least three different visitors (so no one's own text is shown to others), most visitors first.
 */
@Injectable()
export class PopularSearchesService {
  private cached: { searches: string[]; until: number } | null = null

  constructor(private readonly prisma: PrismaService) {}

  async list(now = new Date()): Promise<PopularSearchesDto> {
    if (this.cached && this.cached.until > now.getTime()) return { searches: this.cached.searches }
    const since = new Date(now.getTime() - POPULAR_SEARCH_DAYS * 86_400_000)
    // A few more than needed: the ones that look like personal data are left out afterwards.
    const rows = await this.prisma.$queryRaw<{ query: string }[]>`
      SELECT searchQuery AS query
      FROM ActivityEvent
      WHERE type = ${ActivityType.SEARCH} AND createdAt >= ${since} AND resultCount > 0 AND searchQuery IS NOT NULL
      GROUP BY searchQuery
      HAVING COUNT(DISTINCT visitorId) >= ${POPULAR_SEARCH_MIN_VISITORS}
      ORDER BY COUNT(DISTINCT visitorId) DESC, COUNT(*) DESC, query
      LIMIT ${POPULAR_SEARCHES * 2}`
    const searches = rows
      .map(row => row.query)
      .filter(isShareableSearch)
      .slice(0, POPULAR_SEARCHES)
    this.cached = { searches, until: now.getTime() + CACHE_MS }
    return { searches }
  }
}
