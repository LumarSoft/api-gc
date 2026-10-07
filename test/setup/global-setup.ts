import { execSync } from 'node:child_process'
import { type Connection, createConnection } from 'mariadb'
import { databaseName, testDatabaseUrl } from './test-database'

function connect(url: URL, database?: string): Promise<Connection> {
  return createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  })
}

async function run(connection: Promise<Connection>, sql: string): Promise<void> {
  const open = await connection
  try {
    await open.query(sql)
  } finally {
    await open.end()
  }
}

/**
 * Prepares the e2e database once per run: creates it when missing, applies pending migrations and adds the rows
 * every suite assumes (the default retail price list that `npm run db:seed` creates in development).
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl())
  const name = databaseName(url)
  await run(
    connect(url),
    `CREATE DATABASE IF NOT EXISTS \`${name.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  )
  // Through the shell so `npx` resolves to npx.cmd on Windows. prisma.config.ts loads .env without overriding this.
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url.toString() } })
  // Same code and values as seedPriceLists in src/scripts/seed-catalog.ts.
  await run(
    connect(url, name),
    `INSERT INTO PriceList (code, name, audience, isDefault, updatedAt)
     VALUES ('RETAIL', 'Precio de lista', 'RETAIL', true, NOW(3))
     ON DUPLICATE KEY UPDATE id = id`,
  )
}
