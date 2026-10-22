import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildInfo, codeVersion } from './system-runtime'

describe('code version', () => {
  it('reads the version the build wrote when git is not there', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'build-info-'))
    const path = join(folder, 'build-info.json')
    writeFileSync(
      path,
      JSON.stringify({ commit: 'b833e5f', committedAt: '2026-10-22T00:52:27-03:00', subject: 'Merge' }),
    )
    expect(await buildInfo(path)).toEqual({
      commit: 'b833e5f',
      committedAt: '2026-10-22T00:52:27-03:00',
      subject: 'Merge',
    })
    writeFileSync(path, '{"commit": 5}')
    expect(await buildInfo(path)).toBeNull()
    expect(await buildInfo(join(folder, 'missing.json'))).toBeNull()
  })

  it('reads git when the API runs from a checkout', async () => {
    const version = await codeVersion()
    expect(version?.commit).toMatch(/^[0-9a-f]{7,}$/)
  })
})
