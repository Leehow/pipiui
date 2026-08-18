import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import workspacePackage from '../package.json'
import packageJSON from '../apps/electron/package.json'
import { unsignedBuilderArgs } from './package-electron-target.mjs'

describe('Windows package and CI path', () => {
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/electron.yml'), 'utf8')
  const packager = readFileSync(resolve(import.meta.dirname, './package-electron-target.mjs'), 'utf8')

  it('prepares and checks a win32-x64 embedded runtime before package:win', () => {
    expect(workspacePackage.scripts['runtime:prepare:win']).toBe('node scripts/fetch-pi-runtime.mjs --platform win32 --arch x64')
    expect(workspacePackage.scripts['runtime:check:win']).toContain('--check')
    expect(packageJSON.scripts['package:win']).toContain('package-electron-target.mjs --platform win32 --arch x64')
    expect(packageJSON.scripts['package:win']).toContain('CUA_TARGET_PLATFORM=win32')
    expect(packager).toContain("'--check'")
    expect(packager).toContain('unsignedBuilderArgs')
  })

  it('routes the Windows CI job through runtime prepare and the shared target packager', () => {
    expect(workflow).toContain('runtime:prepare:win')
    expect(workflow).toContain('package-electron-target.mjs --platform win32 --arch x64')
    expect(workflow).toContain('fetch-cua-driver.mjs')
    expect(workflow).toMatch(/if: matrix\.platform == 'win'[\s\S]*package-electron-target\.mjs/)
    expect(workflow).toMatch(/if: matrix\.platform != 'win'[\s\S]*npx electron-builder/)
  })

  it('drops forceCodeSigning only for unsigned Windows/Linux packaging', () => {
    expect(unsignedBuilderArgs('win32', {})).toEqual(['-c.forceCodeSigning=false'])
    expect(unsignedBuilderArgs('linux', {})).toEqual(['-c.forceCodeSigning=false'])
    expect(unsignedBuilderArgs('darwin', {})).toEqual([])
    expect(unsignedBuilderArgs('win32', { CSC_LINK: 'file.p12' })).toEqual([])
    expect(packageJSON.build.forceCodeSigning).toBe(true)
  })
})
