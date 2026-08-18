import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
import {
  assertFreshWindowsInstallerBudget,
  inspectEmbeddedRuntimeTree,
  runtimeStagingPrefix
} from './runtime-package-contract.mjs'

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
    expect(packager).toContain('assertEmbeddedRuntimeTree')
    expect(packager).toContain('assertFreshWindowsInstallerBudget')
  })

  it('stages outside the copied Electron source and rejects recursive or oversized runtimes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pipiui-win-runtime-contract-'))
    try {
      const electronRoot = join(root, 'Electron')
      const prefix = runtimeStagingPrefix(electronRoot, 'win32-x64')
      expect(prefix.startsWith(join(root, 'build'))).toBe(true)
      expect(prefix.startsWith(electronRoot)).toBe(false)

      const runtime = join(root, 'runtime')
      mkdirSync(join(runtime, 'pi', 'lib', 'node_modules'), { recursive: true })
      writeFileSync(join(runtime, 'manifest.json'), 'ok')
      expect(await inspectEmbeddedRuntimeTree(runtime, 1024)).toMatchObject({ ok: true })

      mkdirSync(join(runtime, 'pi', 'lib', 'node_modules', 'pipiui-electron-workspace'))
      expect(await inspectEmbeddedRuntimeTree(runtime, 1024)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('Electron source workspace')
      })
      rmSync(join(runtime, 'pi', 'lib', 'node_modules', 'pipiui-electron-workspace'), { recursive: true })

      mkdirSync(join(runtime, 'pi', 'lib', 'node_modules', 'dependency', '.embedded-runtimes', 'win32-x64'), { recursive: true })
      expect(await inspectEmbeddedRuntimeTree(runtime, 1024)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('recursively embeds .embedded-runtimes')
      })
      rmSync(join(runtime, 'pi', 'lib', 'node_modules', 'dependency'), { recursive: true })

      writeFileSync(join(runtime, 'oversized.bin'), Buffer.alloc(2_048))
      expect(await inspectEmbeddedRuntimeTree(runtime, 1_024)).toMatchObject({
        ok: false,
        reason: expect.stringContaining('over the 1024-byte budget')
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires a fresh Windows installer inside the package size budget', async () => {
    const output = mkdtempSync(join(tmpdir(), 'pipiui-win-installer-budget-'))
    try {
      writeFileSync(join(output, 'PipiUI Setup.exe'), Buffer.alloc(2_048))
      await expect(assertFreshWindowsInstallerBudget(output, 0, { minBytes: 1_024, maxBytes: 4_096 }))
        .resolves.toMatchObject([{ name: 'PipiUI Setup.exe', bytes: 2_048 }])
      writeFileSync(join(output, 'PipiUI Huge.exe'), Buffer.alloc(8_192))
      await expect(assertFreshWindowsInstallerBudget(output, 0, { minBytes: 1_024, maxBytes: 4_096 }))
        .rejects.toThrow('over the 4096-byte budget')
    } finally {
      rmSync(output, { recursive: true, force: true })
    }
  })

  it('does not require Spectre-mitigated CRT libs for Windows native rebuilds', () => {
    const props = readFileSync(resolve(import.meta.dirname, '../Directory.Build.props'), 'utf8')
    expect(props).toContain('<SpectreMitigation>false</SpectreMitigation>')
    expect(props).not.toContain('LibraryPath')
    expect(windowsNativeRebuildEnv('win32', '/repo/Electron').ForceImportBeforeCppTargets).toBe(join('/repo/Electron', 'Directory.Build.props'))
    expect(windowsNativeRebuildEnv('darwin', '/repo/Electron')).toEqual({})
    expect(windowsMsvcEnv('darwin')).toEqual({})
    const isolated = mkdtempSync(join(tmpdir(), 'pipiui-delayimp-'))
    try {
      const fakeVcvars = join(isolated, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
      mkdirSync(dirname(fakeVcvars), { recursive: true })
      writeFileSync(fakeVcvars, '')
      const missingLib = join(isolated, 'missing-lib')
      mkdirSync(missingLib)
      const isolatedEnv = { PIPIUI_VCVARS64: fakeVcvars, PIPIUI_MSVC_LIB_DIR: missingLib }
      expect(windowsMsvcEnv('win32', isolatedEnv)).toEqual({})
      expect(findDelayimpLibDir(isolatedEnv)).toBeUndefined()
      const presentLib = join(isolated, 'present-lib')
      mkdirSync(presentLib)
      writeFileSync(join(presentLib, 'delayimp.lib'), '')
      expect(findDelayimpLibDir({ PIPIUI_VCVARS64: fakeVcvars, PIPIUI_MSVC_LIB_DIR: presentLib })).toBe(presentLib)
      const versionedLib = join(isolated, 'VC', 'Tools', 'MSVC', '14.44.35207', 'lib', 'x64')
      mkdirSync(versionedLib, { recursive: true })
      writeFileSync(join(versionedLib, 'delayimp.lib'), '')
      expect(findDelayimpLibDir({ PIPIUI_VCVARS64: fakeVcvars })).toBe(versionedLib)
    } finally {
      rmSync(isolated, { recursive: true, force: true })
    }
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
