// After `nest build`: writes the commit being built to dist/build-info.json, so the API knows its version even when it
// cannot run git when it starts (a small server under memory pressure). Without git it writes nothing.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

try {
  const [commit, committedAt, subject = ''] = execFileSync('git', ['log', '-1', '--format=%h%n%cI%n%s'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
  writeFileSync(
    'dist/build-info.json',
    JSON.stringify({ commit, committedAt, subject, builtAt: new Date().toISOString() }),
  )
} catch {
  // Not a git checkout: the API shows no version, as before.
}
