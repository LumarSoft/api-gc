import { Logger } from '@nestjs/common'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PrismaService } from './prisma.service'

/** Migration folders (each holds a `migration.sql`) that the database has not finished applying, oldest first. */
export function pendingMigrations(folders: string[], applied: string[]): string[] {
  const done = new Set(applied)
  return folders.filter(folder => !done.has(folder)).sort()
}

/** Why the API cannot start, with the command to fix it. */
export function pendingMigrationsMessage(pending: string[]): string {
  return [
    `The database is missing ${pending.length} migration(s): ${pending.join(', ')}.`,
    'This build expects them; running without them breaks the endpoints that use the new schema.',
    '  Development: npx prisma migrate dev && npx prisma generate',
    '  Production:  npx prisma migrate deploy   (then start the API again)',
    'Context for each change: docs/upgrade-notes.md',
  ].join('\n')
}

export const MIGRATIONS_DIRECTORY = join(process.cwd(), 'prisma', 'migrations')

/**
 * The migrations this code ships with and the ones the database has not applied. Null when `prisma/migrations` is not
 * next to the process (a build copied without the repository): there is nothing to compare with.
 */
export async function migrationStatus(
  prisma: PrismaService,
  directory = MIGRATIONS_DIRECTORY,
): Promise<{ total: number; pending: string[] } | null> {
  if (!existsSync(directory)) return null
  const folders = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(directory, entry.name, 'migration.sql')))
    .map(entry => entry.name)
  let applied: string[] = []
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    applied = rows.map(row => row.migration_name)
  } catch {
    // No migrations table yet: a brand-new database, every migration is pending.
  }
  return { total: folders.length, pending: pendingMigrations(folders, applied) }
}

/**
 * Refuses to start the API when the database lacks migrations this code ships with, so a forgotten
 * `prisma migrate deploy` stops the deploy with a clear message instead of failing requests later. Skipped (with a
 * warning) when `prisma/migrations` is not next to the process, e.g. a build copied without the repository.
 */
export async function assertMigrationsApplied(prisma: PrismaService, directory = MIGRATIONS_DIRECTORY): Promise<void> {
  const log = new Logger('Migrations')
  const status = await migrationStatus(prisma, directory)
  if (!status) {
    log.warn(`Could not check pending migrations: ${directory} does not exist.`)
    return
  }
  if (status.pending.length > 0) throw new Error(pendingMigrationsMessage(status.pending))
  log.log(`Database schema up to date (${status.total} migrations)`)
}
