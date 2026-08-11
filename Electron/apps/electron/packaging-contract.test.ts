import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import nodeRuntimeAssets from '../../node-runtime-assets.json'
import workspacePackage from '../../package.json'
import packageJSON from './package.json'

describe('macOS packaging contract', () => {
  const wrapper = readFileSync(resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh'), 'utf8')
  const targetPackager = readFileSync(resolve(import.meta.dirname, '../../scripts/package-electron-target.mjs'), 'utf8')
  it('packages x64 and arm64 sequentially so their app staging directories cannot race', () => {
    const script = packageJSON.scripts['package:mac']
    expect(script).toMatch(/package-electron-target\.mjs --platform darwin --arch x64 -- --mac --x64 && node .*package-electron-target\.mjs --platform darwin --arch arm64 -- --mac --arm64/)
    expect(script).not.toContain('fetch-pi-runtime.mjs')
    expect(packageJSON.build.mac.target).toEqual(['dmg', 'zip'])
  })

  it('ships one Electron-owned runtime tree and no foreign source tree', () => {
    expect(packageJSON.build.extraResources).toContainEqual(expect.objectContaining({
      from: '../../resources/runtime',
      to: 'pipiui-runtime'
    }))
    expect(packageJSON.build.extraResources.map(entry => entry.to)).not.toEqual(
      expect.arrayContaining(['pi-ext', 'pi-philosophy', 'swift-extensions'])
    )
    expect(packageJSON.build.extraResources).toContainEqual(expect.objectContaining({
      from: '../../.embedded-runtimes/${env.PIPIUI_EMBEDDED_RUNTIME_TARGET}',
      to: 'pipiui-embedded'
    }))
  })

  it('checks and selects exactly one persistent target without preparing during release', () => {
    expect(packageJSON.scripts['package:win']).toContain('package-electron-target.mjs --platform win32 --arch x64')
    expect(packageJSON.scripts['package:linux']).toContain('package-electron-target.mjs --platform linux --arch x64')
    expect(targetPackager).toContain("'--check'")
    expect(targetPackager).toContain('PIPIUI_EMBEDDED_RUNTIME_TARGET: key')
    expect(targetPackager).not.toContain("'--force'")
    const runtimeCalls = wrapper.split('\n').filter(line => line.includes('fetch-pi-runtime.mjs'))
    expect(runtimeCalls.length).toBeGreaterThan(0)
    expect(runtimeCalls.every(line => line.includes('--check'))).toBe(true)
    expect(wrapper).not.toContain('npm install')
    expect(packageJSON.build.mac.binaries).toContain('Contents/Resources/pipiui-embedded/node/bin/node')
    expect(packageJSON.build.forceCodeSigning).toBe(true)
  })

  it('exposes prepare/check/update workflows and prepares before direct development', () => {
    expect(workspacePackage.scripts['runtime:prepare']).toBe('node scripts/fetch-pi-runtime.mjs')
    expect(workspacePackage.scripts['runtime:check']).toContain('--check')
    expect(workspacePackage.scripts['runtime:update']).toContain('--force')
    expect(workspacePackage.scripts['runtime:prepare:mac']).toContain('--arch x64')
    expect(workspacePackage.scripts['runtime:prepare:mac']).toContain('--arch arm64')
    expect(workspacePackage.scripts['runtime:check:mac']).toContain('--check')
    expect(packageJSON.scripts.predev).toBe('node ../../scripts/fetch-pi-runtime.mjs')
    expect(packageJSON.scripts['predev:watch']).toBe('node ../../scripts/fetch-pi-runtime.mjs')
  })

  it('reseals and strictly verifies each settled architecture with the stable identity', () => {
    expect(wrapper).toMatch(/package_mac_arch x64 "\$ROOT\/build\/mac"[\s\S]*package_mac_arch arm64 "\$ROOT\/build\/mac-arm64"/)
    expect(wrapper).not.toMatch(/codesign --sign[^\n]*--deep/)
    expect(wrapper).toContain('discover_macho_candidates "$app"')
    expect(wrapper).toMatch(/find "\$app\/Contents" -type f \\\([\s\S]*-perm -111[\s\S]*-name '\*\.node'[\s\S]*-name '\*\.dylib'[\s\S]*-name '\*\.so'/)
    expect(wrapper).not.toContain('find "$app/Contents" -type f -print')
    expect(wrapper).toContain("-name '*.framework' -o -name '*.xpc' -o -name '*.app'")
    expect(wrapper).toMatch(/codesign --sign "\$CSC_NAME" --force --timestamp --options runtime[\s\S]*--entitlements "\$MAC_INHERIT_ENTITLEMENTS" "\$nested"/)
    expect(wrapper).toMatch(/codesign --sign "\$CSC_NAME" --force --timestamp --options runtime[\s\S]*--entitlements "\$MAC_ENTITLEMENTS" "\$app"/)
    expect(wrapper).toMatch(/codesign --verify --deep --strict --verbose=2 "\$app"/)
    expect(wrapper).toMatch(/mv "\$APP_SRC" "\$APP_DST"[\s\S]*codesign --verify --deep --strict --verbose=2 "\$APP_DST"/)
  })

  it('recovers only an exact root sealed-resource failure with a complete expected bundle', () => {
    expect(wrapper).toContain('builder_failure_is_outer_seal_only "$log" "$app"')
    expect(wrapper).toMatch(/grep -Fq "\$app" "\$log"/)
    expect(wrapper).toMatch(/a sealed resource is missing or invalid\|file \(added\|modified\|missing\):\|resource envelope is obsolete/)
    for (const resource of [
      'Contents/MacOS/PipiUI Electron',
      'Contents/Frameworks/Electron Framework.framework',
      'Contents/Resources/cua-driver/cua-driver',
      'Contents/Resources/pipiui-embedded/node/bin/node',
      'Contents/Resources/pipiui-runtime'
    ]) expect(wrapper).toContain(resource)
    expect(wrapper).toContain('failure is not the recoverable outer sealed-resource verification class')
  })

  it('sources and exercises package_mac_arch safely under nounset', () => {
    const scriptPath = resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh')
    const output = execFileSync('/bin/bash', ['-c', [
      'set -euo pipefail',
      `eval "$(sed '/^PLATFORM=/,$d' ${JSON.stringify(scriptPath)})"`,
      'PIPIUI_ELECTRON_PACKAGING_FUNCTION_TEST=1 package_mac_arch arm64 "/tmp/mac-arm64"'
    ].join('\n')], { encoding: 'utf8' })
    expect(output.trim()).toBe('/tmp/mac-arm64/PipiUI Electron.app')
  })

  it('discovers a non-executable Mach-O native module by suffix without scanning unrelated resources', () => {
    if (process.platform !== 'darwin') return
    const scriptPath = resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh')
    const output = execFileSync('/bin/bash', ['-c', [
      'set -euo pipefail',
      'fixture="$(mktemp -d)"',
      'trap \'rm -rf "$fixture"\' EXIT',
      'mkdir -p "$fixture/Test.app/Contents/Resources"',
      `cp ${JSON.stringify(process.execPath)} "$fixture/Test.app/Contents/Resources/native-addon.node"`,
      'chmod 0644 "$fixture/Test.app/Contents/Resources/native-addon.node"',
      'cp "$fixture/Test.app/Contents/Resources/native-addon.node" "$fixture/Test.app/Contents/Resources/unrelated.dat"',
      `eval "$(sed '/^PLATFORM=/,$d' ${JSON.stringify(scriptPath)})"`,
      'discover_macho_candidates "$fixture/Test.app"'
    ].join('\n')], { encoding: 'utf8' })
    expect(output.trim()).toMatch(/native-addon\.node$/)
    expect(output).not.toContain('unrelated.dat')
  })

  it('pins checksum-verified official Node 22.19.0 archives for every shipping target', () => {
    expect(nodeRuntimeAssets.version).toBe('22.19.0')
    expect(Object.keys(nodeRuntimeAssets.assets).sort()).toEqual([
      'darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'
    ])
    for (const asset of Object.values(nodeRuntimeAssets.assets)) {
      expect(asset.archive).toContain('node-v22.19.0-')
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })
})
