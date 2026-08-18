import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import workspacePackage from '../package.json'
import packageJSON from '../apps/electron/package.json'
import {
  appendWindowsLibDir,
  findDelayimpLibDir,
  unsignedBuilderArgs,
  windowsMsvcEnv,
  windowsNativeRebuildEnv,
  writeWindowsPtyBuildProps
} from './package-electron-target.mjs'

describe('Windows package and CI path', () => {
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/electron.yml'), 'utf8')
  const packager = readFileSync(resolve(import.meta.dirname, './package-electron-target.mjs'), 'utf8')

  it('prepares and checks a win32-x64 embedded runtime before package:win', () => {
    expect(workspacePackage.scripts['runtime:prepare:win']).toBe('node scripts/fetch-pi-runtime.mjs --platform win32 --arch x64')
    expect(workspacePackage.scripts['runtime:check:win']).toContain('--check')
    expect(packageJSON.scripts['package:win']).toContain('package-electron-target.mjs --platform win32 --arch x64')
    expect(packageJSON.scripts['package:win']).toContain('fetch-cua-driver.mjs')
    expect(packageJSON.scripts['package:win']).not.toContain('CUA_TARGET_PLATFORM=')
    expect(packager).toContain("'--check'")
    expect(packager).toContain('unsignedBuilderArgs')
  })

  it('routes the Windows CI job through runtime prepare and the shared target packager', () => {
    expect(workspacePackage.scripts['test:win']).toContain('windows-package-path.test.ts')
    expect(workflow).toContain('runtime:prepare:win')
    expect(workflow).toContain('npm run test:win')
    expect(workflow).toMatch(/if: matrix\.platform != 'win'[\s\S]*npm test/)
    expect(workflow).toMatch(/if: matrix\.platform == 'win'[\s\S]*npm run test:win/)
    expect(workflow).toContain('package-electron-target.mjs --platform win32 --arch x64')
    expect(workflow).toContain('fetch-cua-driver.mjs')
    expect(workflow).toMatch(/if: matrix\.platform == 'win'[\s\S]*package-electron-target\.mjs/)
    expect(workflow).toMatch(/if: matrix\.platform != 'win'[\s\S]*npx electron-builder/)
  })

  it('does not require Spectre-mitigated CRT libs for Windows native rebuilds', () => {
    const props = readFileSync(resolve(import.meta.dirname, '../Directory.Build.props'), 'utf8')
    expect(props).toContain('<SpectreMitigation>false</SpectreMitigation>')
    expect(props).not.toContain('LibraryPath')
    expect(windowsNativeRebuildEnv('win32', '/repo/Electron').ForceImportBeforeCppTargets).toBe('/repo/Electron/Directory.Build.props')
    expect(windowsNativeRebuildEnv('darwin', '/repo/Electron')).toEqual({})
    expect(windowsMsvcEnv('win32')).toEqual({})
    expect(windowsMsvcEnv('darwin')).toEqual({})
    expect(findDelayimpLibDir({})).toBeUndefined()
    expect(packager).toContain('windowsNativeRebuildEnv')
    expect(packager).toContain('windowsMsvcEnv')
    expect(packager).toContain('appendWindowsLibDir')
  })

  it('appends delayimp to vcvars LIB without dropping SDK or UCRT paths', () => {
    const vcvars = {
      INCLUDE: 'C:\\Kits\\Include\\10.0.26100.0\\um;C:\\MSVC\\include',
      LIB: 'C:\\Kits\\Lib\\10.0.26100.0\\um\\x64;C:\\Kits\\Lib\\10.0.26100.0\\ucrt\\x64;C:\\MSVC\\lib\\x64',
      LIBPATH: 'C:\\Kits\\Lib\\10.0.26100.0\\um\\x64;C:\\MSVC\\lib\\x64'
    }
    const delayimp = 'C:\\MSVC\\14.44.35207\\lib\\x64'
    const merged = appendWindowsLibDir(vcvars, delayimp)
    expect(merged.INCLUDE).toBe(vcvars.INCLUDE)
    expect(merged.LIB.startsWith(vcvars.LIB)).toBe(true)
    expect(merged.LIB).toContain('10.0.26100.0\\um\\x64')
    expect(merged.LIB).toContain('ucrt\\x64')
    expect(merged.LIB.endsWith(delayimp)).toBe(true)
    expect(appendWindowsLibDir(merged, delayimp).LIB).toBe(merged.LIB)
    expect(appendWindowsLibDir(vcvars, undefined).LIB).toBe(vcvars.LIB)
  })

  it('writes Spectre-only node-pty props and never sets LibraryPath', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipiui-win-props-'))
    try {
      const written = writeWindowsPtyBuildProps(root)
      expect(written.length).toBe(3)
      for (const dir of written) {
        const text = readFileSync(join(dir, 'Directory.Build.props'), 'utf8')
        expect(text).toContain('<SpectreMitigation>false</SpectreMitigation>')
        expect(text).not.toContain('LibraryPath')
      }
      expect(packager).not.toMatch(/LibraryPath\}?\$\{/)
      expect(packager).not.toContain('findWindowsSdkLibDirs')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('drops forceCodeSigning only for unsigned Windows/Linux packaging', () => {
    expect(unsignedBuilderArgs('win32', {})).toEqual(['-c.forceCodeSigning=false'])
    expect(unsignedBuilderArgs('linux', {})).toEqual(['-c.forceCodeSigning=false'])
    expect(unsignedBuilderArgs('darwin', {})).toEqual([])
    expect(unsignedBuilderArgs('win32', { CSC_LINK: 'file.p12' })).toEqual([])
    expect(packageJSON.build.forceCodeSigning).toBe(true)
  })
})
