import { config } from 'dotenv'

/**
 * Resolves the database the e2e suites use, so they never write into the development database.
 *
 * TEST_DATABASE_URL wins when set. Otherwise it is DATABASE_URL with `_test` appended to the database name
 * (`.../cg` → `.../cg_test`), same server and credentials. scripts/doctor.mjs mirrors this rule.
 */
export function testDatabaseUrl(): string {
  config({ quiet: true })
  const devUrl = process.env.DATABASE_URL
  if (!devUrl) throw new Error('DATABASE_URL is not set (see .env.example)')
  const url = new URL(process.env.TEST_DATABASE_URL || devUrl)
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${databaseName(url)}_test`
  const dev = new URL(devUrl)
  if (url.host === dev.host && databaseName(url) === databaseName(dev)) {
    throw new Error('TEST_DATABASE_URL points to the development database; use a separate one (e.g. cg_test)')
  }
  return url.toString()
}

export function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}
