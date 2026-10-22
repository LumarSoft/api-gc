import { execFile } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { cpus, freemem, loadavg, totalmem } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The commit the API runs, as the checkout it started from says. */
export interface CodeVersion {
  commit: string
  committedAt: string
  /** First line of the commit message, e.g. "Merge pull request #55 from LumarSoft/feat/developer-role". */
  subject: string
}

/**
 * Read once when the API starts: a `git pull` without a restart does not change the code that runs. From git, or else
 * from `dist/build-info.json`, written by `npm run build`: on the server, starting right after a build (with little
 * memory left) git can fail. Null when neither is there.
 */
export async function codeVersion(cwd = process.cwd()): Promise<CodeVersion | null> {
  return (await gitVersion(cwd)) ?? (await buildInfo(join(cwd, 'dist', 'build-info.json')))
}

async function gitVersion(cwd: string): Promise<CodeVersion | null> {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%h%n%cI%n%s'], { cwd, timeout: 10_000 })
    const [commit, committedAt, subject = ''] = stdout.trim().split('\n')
    return commit && committedAt ? { commit, committedAt, subject } : null
  } catch {
    return null
  }
}

/** The version `scripts/write-build-info.mjs` wrote next to the build; null when missing or malformed. */
export async function buildInfo(path: string): Promise<CodeVersion | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<Record<keyof CodeVersion, unknown>>
    const { commit, committedAt, subject } = value
    return typeof commit === 'string' && typeof committedAt === 'string'
      ? { commit, committedAt, subject: typeof subject === 'string' ? subject : '' }
      : null
  } catch {
    return null
  }
}

export interface MachineUsage {
  /** Memory used by this process (resident set). */
  processBytes: number
  systemTotalBytes: number
  systemFreeBytes: number
  /** Average load over 1, 5 and 15 minutes; compare it with `cpus`. */
  load: number[]
  cpus: number
}

export function machineUsage(): MachineUsage {
  return {
    processBytes: process.memoryUsage().rss,
    systemTotalBytes: totalmem(),
    systemFreeBytes: freemem(),
    load: loadavg().map(value => Math.round(value * 100) / 100),
    cpus: cpus().length,
  }
}

/** Space on the disk that holds `path` (the uploaded files). Null when it cannot be read. */
export async function diskUsage(path: string): Promise<{ path: string; totalBytes: number; freeBytes: number } | null> {
  try {
    const stats = await statfs(path)
    return { path, totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize }
  } catch {
    return null
  }
}
