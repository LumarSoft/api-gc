#!/usr/bin/env node
/**
 * Runs after `git pull`, merge, rebase or a branch switch (.husky/post-merge, post-checkout, post-rewrite):
 *
 *   node scripts/after-pull.mjs <previous commit> [<new commit>]
 *
 * When the update touched something that may need a manual step (dependencies, schema, migrations, env vars, upgrade
 * notes), it lists the new entries of docs/upgrade-notes.md and runs the doctor, so nobody has to remember to look.
 * It never fails: a problem here must not break git.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const [from, to = 'HEAD'] = process.argv.slice(2)

/** Files whose change can mean "do something before working". */
const NEEDS_ATTENTION =
  /^(package\.json|package-lock\.json|\.nvmrc|\.env\.example|prisma\/|docs\/upgrade-notes\.md|scripts\/doctor\.mjs)/

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })

function main() {
  // No previous commit (fresh clone) or nothing moved: the doctor runs on `npm install` / session start instead.
  if (!from || /^0+$/.test(from)) return
  let changed
  try {
    changed = git('diff', '--name-only', from, to).split('\n').filter(Boolean)
  } catch {
    return
  }
  const relevant = changed.filter(file => NEEDS_ATTENTION.test(file))
  if (relevant.length === 0) return

  const notes = git('diff', from, to, '--', 'docs/upgrade-notes.md')
    .split('\n')
    .filter(line => line.startsWith('+## '))
    .map(line => line.slice(4))
  const hints = []
  if (relevant.some(file => /^package(-lock)?\.json$/.test(file))) hints.push('Dependencies changed → npm install')
  if (relevant.some(file => file.startsWith('prisma/migrations/')))
    hints.push('New migrations → npx prisma migrate dev && npx prisma generate')
  else if (relevant.some(file => file.startsWith('prisma/schema/'))) hints.push('Schema changed → npx prisma generate')

  console.log('\n━━━ api-gc: this update may need a step from you ━━━')
  if (notes.length > 0) {
    console.log('New in docs/upgrade-notes.md (read them, they say what to run):')
    for (const note of notes) console.log(`  • ${note}`)
  }
  for (const hint of hints) console.log(`  • ${hint}`)
  console.log('Checking your setup (npm run doctor)…')
  spawnSync(process.execPath, [join(ROOT, 'scripts', 'doctor.mjs'), '--brief'], { cwd: ROOT, stdio: 'inherit' })
  console.log('━━━\n')
}

try {
  main()
} catch {
  // Never break git over a notice.
}
