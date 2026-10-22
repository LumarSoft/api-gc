import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
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

/** Read once when the API starts: a `git pull` without a restart does not change the code that runs. Null outside a checkout. */
export async function codeVersion(cwd = process.cwd()): Promise<CodeVersion | null> {
  try {
    const { stdout } = await run('git', ['log', '-1', '--format=%h%n%cI%n%s'], { cwd, timeout: 3000 })
    const [commit, committedAt, subject = ''] = stdout.trim().split('\n')
    return commit && committedAt ? { commit, committedAt, subject } : null
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
