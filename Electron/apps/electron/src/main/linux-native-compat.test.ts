import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  findTooNew,
  parseGlibcVersions
} from '../../../../scripts/check-linux-pty-glibc.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')

describe('linux native glibc packaging contract', () => {
  it('pins the linux CI runner to ubuntu-22.04', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/electron.yml'), 'utf8')
    expect(workflow).toMatch(/platform:\s*linux[\s\S]*os:\s*ubuntu-22\.04/)
    expect(workflow).not.toMatch(/platform:\s*linux[\s\S]*os:\s*ubuntu-latest/)
  })

  it('flags GLIBC_2.42 as too new', () => {
    const versions = parseGlibcVersions('  0x00  GLIBC_2.42  GLIBC_2.34')
    expect(versions).toContain('2.42')
    expect(findTooNew(versions).length).toBeGreaterThan(0)
  })

  it('accepts only 2.34/2.35', () => {
    const versions = parseGlibcVersions('GLIBC_2.34 GLIBC_2.35')
    expect(findTooNew(versions)).toEqual([])
  })

  it('package-electron-target.mjs invokes the glibc check', () => {
    const source = readFileSync(
      join(repoRoot, 'Electron/scripts/package-electron-target.mjs'),
      'utf8'
    )
    expect(source).toContain('check-linux-pty-glibc')
    expect(source).not.toContain('apps/electron/dist')
    expect(source).not.toContain('searchRoots')
    expect(source).not.toMatch(/try \{[\s\S]*catch \(error\) \{[\s\S]*lastError/)
  })
})
