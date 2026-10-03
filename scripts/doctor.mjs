#!/usr/bin/env node
/**
 * Checks that this machine has everything the current code needs and prints how to fix what is missing.
 *
 *   npm run doctor            full report
 *   node scripts/doctor.mjs --brief   only problems (used by the Claude Code SessionStart hook)
 *
 * When a change needs a new manual step (env var, migration, seed…), add a check here and an entry in
 * docs/upgrade-notes.md in the same PR.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath keeps Windows paths valid (C:\...).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const brief = process.argv.includes('--brief')
const results = []

const ok = message => results.push({ level: 'ok', message })
const warn = (message, fix) => results.push({ level: 'warn', message, fix })
const fail = (message, fix) => results.push({ level: 'fail', message, fix })

function parseEnv(path) {
  if (!existsSync(path)) return null
  const entries = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) entries[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return entries
}

// 1. Node version
const requiredMajor = Number(readFileSync(join(ROOT, '.nvmrc'), 'utf-8').trim().replace(/^v/, '').split('.')[0])
const currentMajor = Number(process.versions.node.split('.')[0])
if (currentMajor >= requiredMajor) ok(`Node ${process.versions.node}`)
else fail(`Node ${process.versions.node} is older than ${requiredMajor}`, 'nvm use')

// 2. Dependencies
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const missingDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
  name => !existsSync(join(ROOT, 'node_modules', name, 'package.json')),
)
if (missingDeps.length === 0) ok('Dependencies installed')
else
  fail(`Missing dependencies: ${missingDeps.slice(0, 5).join(', ')}${missingDeps.length > 5 ? '…' : ''}`, 'npm install')

// 3. Environment variables
const example = parseEnv(join(ROOT, '.env.example')) ?? {}
const env = parseEnv(join(ROOT, '.env'))
if (!env) {
  fail('.env does not exist', 'cp .env.example .env  (then fill DATABASE_URL and JWT_SECRET)')
} else {
  const missingKeys = Object.keys(example).filter(key => !(key in env))
  if (missingKeys.length === 0) ok('.env has every variable from .env.example')
  else fail(`.env is missing: ${missingKeys.join(', ')}`, 'copy them from .env.example (see docs/upgrade-notes.md)')
  if ((env.JWT_SECRET ?? '').length < 32) {
    fail(
      'JWT_SECRET is empty or shorter than 32 characters',
      `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  → paste into .env`,
    )
  }
}

// 4. Prisma client generated from the current schema (compared by content: switching branches changes file dates)
const schemaDir = join(ROOT, 'prisma', 'schema')
const generatedClass = join(ROOT, 'src', 'generated', 'prisma', 'internal', 'class.ts')
if (!existsSync(generatedClass)) {
  fail('Prisma client not generated', 'npx prisma generate')
} else {
  const inline = readFileSync(generatedClass, 'utf-8').match(/"inlineSchema":\s*("(?:[^"\\]|\\.)*")/)
  const normalize = text => text.replace(/\s+/g, ' ').trim()
  const generatedSchema = inline ? normalize(JSON.parse(inline[1])) : ''
  const stale = readdirSync(schemaDir)
    .filter(file => file.endsWith('.prisma'))
    .filter(file => !generatedSchema.includes(normalize(readFileSync(join(schemaDir, file), 'utf-8'))))
  if (stale.length === 0) ok('Prisma client matches the schema')
  else fail(`Prisma client is outdated (${stale.join(', ')} changed)`, 'npx prisma generate')
}

// 5. Database reachable and migrations applied
if (env?.DATABASE_URL) {
  try {
    // Through the shell so `npx` resolves to npx.cmd on Windows.
    execSync('npx prisma migrate status', { cwd: ROOT, stdio: 'pipe', timeout: 30_000 })
    ok('Database reachable, all migrations applied')
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (/not yet been applied|have not been applied/i.test(output)) {
      fail('Pending database migrations', 'npx prisma migrate dev && npx prisma generate')
    } else if (/P1001|Can't reach database|ECONNREFUSED/i.test(output)) {
      fail('Database not reachable', 'start MySQL (npm run db:up or your local server) and check DATABASE_URL')
    } else if (/P1000|Authentication failed|Access denied/i.test(output)) {
      fail('Database rejected the credentials', 'check user and password in DATABASE_URL')
    } else {
      warn('Could not check migrations', 'npx prisma migrate status')
    }
  }
}

// 6. Starter catalog loaded (its images are copied into storage)
const productImages = join(ROOT, env?.STORAGE_DIR || 'storage', 'public', 'products')
if (existsSync(productImages) && readdirSync(productImages).length > 0) ok('Starter catalog loaded')
else warn('Starter catalog not loaded (the store will look empty)', 'npm run db:seed')

// Report
const problems = results.filter(result => result.level !== 'ok')
if (brief) {
  if (problems.length === 0) console.log('api-gc doctor: environment OK.')
  else {
    console.log('api-gc doctor found setup problems. Fix them before working (details: docs/upgrade-notes.md):')
    for (const p of problems) console.log(`- ${p.level === 'fail' ? 'ERROR' : 'WARN'}: ${p.message} → ${p.fix}`)
  }
} else {
  for (const r of results) {
    const icon = r.level === 'ok' ? '✓' : r.level === 'warn' ? '!' : '✗'
    console.log(`${icon} ${r.message}${r.fix ? `\n    → ${r.fix}` : ''}`)
  }
  console.log(
    problems.length === 0 ? '\nEverything is ready.' : '\nSee docs/upgrade-notes.md for the context of each step.',
  )
}
process.exitCode = results.some(result => result.level === 'fail') ? 1 : 0
