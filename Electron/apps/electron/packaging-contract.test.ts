import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import nodeRuntimeAssets from '../../node-runtime-assets.json'
import workspacePackage from '../../package.json'
import packageJSON from './package.json'

describe('macOS packaging contract', () => {
  const wrapper = readFileSync(resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh'), 'utf8')
  const targetPackager = readFileSync(resolve(import.meta.dirname, '../../scripts/package-electron-target.mjs'), 'utf8')
  const runtimePreparer = readFileSync(resolve(import.meta.dirname, '../../scripts/fetch-pi-runtime.mjs'), 'utf8')
  const brokerPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../resources/runtime/pi-ext/packages/memory-broker/package.json'), 'utf8'))
  it('packages x64 and arm64 sequentially so their app staging directories cannot race', () => {
    const script = packageJSON.scripts['package:mac']
    expect(script).toMatch(/package-electron-target\.mjs --platform darwin --arch x64 -- --mac --x64 && node .*package-electron-target\.mjs --platform darwin --arch arm64 -- --mac --arm64/)
    expect(script).not.toContain('fetch-pi-runtime.mjs')
    expect(packageJSON.build.mac.target).toEqual(['dmg', 'zip'])
  })

  it('keeps the artifact folder as PipiUI Electron while Launchpad/Dock show PipiUI', () => {
    expect(packageJSON.build.productName).toBe('PipiUI Electron')
    expect(packageJSON.build.appId).toBe('com.leehow.pipiui-electron')
    expect(packageJSON.build.mac.extendInfo.CFBundleDisplayName).toBe('PipiUI')
    // Electron resolves helpers as `${CFBundleName} Helper.app`. Shortening
    // CFBundleName to "PipiUI" makes launch abort with "Unable to find helper app".
    expect(packageJSON.build.mac.extendInfo.CFBundleName ?? packageJSON.build.productName).toBe(
      packageJSON.build.productName
    )
    expect(packageJSON.build.linux.executableName).toBe('pipiui_e')
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

  it('ships Hermes through the target-specific embedded runtime, never the source-tree node_modules exclusion', () => {
    const runtimeSource = packageJSON.build.extraResources.find(entry => entry.to === 'pipiui-runtime')
    const embedded = packageJSON.build.extraResources.find(entry => entry.to === 'pipiui-embedded')
    expect(runtimeSource?.filter).toContain('!**/node_modules/**')
    expect(packageJSON.build.extraResources).toContainEqual(expect.objectContaining({
      from: '../../resources/runtime/pdf-inspector/node_modules',
      to: 'pipiui-runtime/pdf-inspector/node_modules'
    }))
    expect(embedded?.from).toBe('../../.embedded-runtimes/${env.PIPIUI_EMBEDDED_RUNTIME_TARGET}')
    expect(embedded?.filter).toBeUndefined()
    expect(brokerPackage.dependencies['pi-hermes-memory']).toBe('0.9.6')
    expect(runtimePreparer).toContain("const hermesPackageName = 'pi-hermes-memory'")
    // Native modules must be built for the ABI that will actually load them. 4875076d
    // split this by platform: macOS runs the embedded runtime as standalone Node, while
    // the other targets load it inside Electron via ELECTRON_RUN_AS_NODE.
    expect(runtimePreparer).toContain("npm_config_runtime: platform === 'darwin' ? 'node' : 'electron'")
    expect(runtimePreparer).toContain("npm_config_target: platform === 'darwin' ? metadata.version : electronVersion")
    expect(runtimePreparer).toContain("npm_config_disturl: platform === 'darwin' ? 'https://nodejs.org/dist' : 'https://electronjs.org/headers'")
    expect(runtimePreparer).toContain('npm_config_arch: arch')
  })

  // electron-builder's `files` allow-list governs only the app source file set:
  // production node_modules are collected separately by computeNodeModuleFileSets
  // and can be dropped only with negation patterns. electron-vite bundles every
  // import except the ones externalizeDepsPlugin leaves as bare requires, so the
  // packaged asar needs exactly those and nothing else.
  /**
   * `createRequire(<expr>)("x")`. The argument nests its own parens
   * (`createRequire(require("url").pathToFileURL(__filename).href)`), so walk the
   * balance rather than letting a wildcard run past the real closing paren into an
   * unrelated call further down the bundle.
   */
  const createRequireSpecifiers = (source: string): string[] => {
    const specifiers: string[] = []
    const opener = /\bcreateRequire\(/g
    for (let match = opener.exec(source); match; match = opener.exec(source)) {
      let depth = 1
      let i = match.index + match[0].length
      for (; i < source.length && depth > 0; i++) {
        if (source[i] === '(') depth++
        else if (source[i] === ')') depth--
      }
      if (depth !== 0) continue
      const call = /^\("([^"]+)"\)/.exec(source.slice(i))
      if (call) specifiers.push(call[1])
    }
    return specifiers
  }

  const bundledExternals = () => {
    const mainOut = resolve(import.meta.dirname, 'out/main')
    if (!existsSync(mainOut)) return undefined
    const builtins = new Set(builtinModules)
    const found = new Set<string>()
    for (const file of readdirSync(mainOut)) {
      if (!file.endsWith('.js')) continue
      const source = readFileSync(resolve(mainOut, file), 'utf8')
      // Two bare-require forms survive bundling: the plain `require("x")` electron-vite
      // emits for externalized deps, and `createRequire(...)("x")` for a dependency the
      // source loads lazily (terminal-host does this for node-pty). Missing the second
      // form reads as "nothing needs this package" and invites dropping a package the
      // packaged app really loads at runtime.
      const specifiers = [
        ...[...source.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1]),
        ...createRequireSpecifiers(source),
      ]
      for (const specifier of specifiers) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
        if (builtins.has(specifier) || specifier === 'electron') continue
        found.add(specifier)
      }
    }
    return found
  }

  it('ships only the node_modules the main bundle still requires at runtime', () => {
    const files = packageJSON.build.files
    expect(files).toContain('!node_modules/**/*')
    const reincluded = files
      .filter(pattern => pattern.startsWith('node_modules/'))
      .map(pattern => pattern.replace(/^node_modules\//, '').replace(/\/\*\*\/\*$/, ''))
    // Negations and re-inclusions are applied in order, so every kept package
    // must be listed after the blanket exclusion.
    for (const pattern of reincluded) {
      expect(files.indexOf('!node_modules/**/*')).toBeLessThan(files.indexOf(`node_modules/${pattern}/**/*`))
    }
    const externals = bundledExternals()
    if (!externals) return // out/ is a build artifact; nothing to check before `npm run build`
    expect([...externals].sort()).toEqual(reincluded.sort())
  })

  it('ships one Cua driver slice per target and fetches the slice each package script packages', () => {
    // The macOS download is a universal binary; shipping both slices doubled the
    // driver in every single-arch build.
    expect(packageJSON.build.extraResources).toContainEqual(expect.objectContaining({
      from: '../../.cua-driver/${env.PIPIUI_EMBEDDED_RUNTIME_TARGET}',
      to: 'cua-driver'
    }))
    const fetchCua = readFileSync(resolve(import.meta.dirname, '../../scripts/fetch-cua-driver.mjs'), 'utf8')
    expect(fetchCua).toContain('materializePackagedDarwinCuaDriverSlice')
    expect(fetchCua).toContain("await rm(join(targetDir, CUA_DRIVER_HELPER_APP)")
    // PIPIUI_EMBEDDED_RUNTIME_TARGET is `<platform>-<arch>`, so whatever the fetch
    // step lays down has to be keyed the same way the packaging step reads it.
    for (const [script, platform] of [['package:mac', 'darwin'], ['package:win', 'win32'], ['package:linux', 'linux']] as const) {
      expect(packageJSON.scripts[script]).toContain(`CUA_TARGET_PLATFORM=${platform}`)
      expect(packageJSON.scripts[script]).toContain('fetch-cua-driver.mjs')
    }
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
    // The embedded Node is a shell shim that execs Electron in Node mode, not a
    // Mach-O. Listing it here would make electron-builder try to codesign a
    // script; finalize_mac_bundle skips it on its own because
    // discover_macho_candidates settles format with `file`.
    expect(packageJSON.build.mac.binaries).toBeUndefined()
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
    expect(wrapper).toMatch(/--entitlements "\$MAC_ENTITLEMENTS" "\$app"\s+#[\s\S]*verify_embedded_node_signing "\$embedded_node" "\$app"\s+codesign --verify --deep --strict --verbose=2 "\$app"/)
    expect(wrapper).toMatch(/codesign --verify --deep --strict --verbose=2 "\$app"/)
    expect(wrapper).toMatch(/mv "\$APP_SRC" "\$APP_DST"[\s\S]*codesign --verify --deep --strict --verbose=2 "\$APP_DST"/)
  })

  it('grants JIT entitlements only to the embedded Node loose Mach-O', () => {
    if (process.platform !== 'darwin') return
    const scriptPath = resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh')
    const entitlementsPath = resolve(import.meta.dirname, '../../node_modules/app-builder-lib/templates/entitlements.mac.plist')
    const output = execFileSync('/bin/bash', ['-c', [
      'set -euo pipefail',
      'fixture="$(mktemp -d)"',
      'trap \'rm -rf "$fixture"\' EXIT',
      'app="$fixture/Test.app"',
      'embedded_node="$app/Contents/Resources/pipiui-embedded/node/bin/node"',
      'generic_helper="$app/Contents/Resources/native-helper"',
      'codesign_log="$fixture/codesign.log"',
      'mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks/Electron Framework.framework"',
      'mkdir -p "$app/Contents/Resources/cua-driver" "$(dirname "$embedded_node")"',
      'mkdir -p "$app/Contents/Resources/pipiui-runtime"',
      `cp ${JSON.stringify(process.execPath)} "$app/Contents/MacOS/PipiUI Electron"`,
      `cp ${JSON.stringify(process.execPath)} "$app/Contents/Resources/cua-driver/cua-driver"`,
      `cp ${JSON.stringify(process.execPath)} "$embedded_node"`,
      `cp ${JSON.stringify(process.execPath)} "$generic_helper"`,
      'chmod +x "$app/Contents/MacOS/PipiUI Electron" "$app/Contents/Resources/cua-driver/cua-driver" "$embedded_node" "$generic_helper"',
      `eval "$(sed '/^PLATFORM=/,$d' ${JSON.stringify(scriptPath)})"`,
      `MAC_ENTITLEMENTS=${JSON.stringify(entitlementsPath)}`,
      'MAC_INHERIT_ENTITLEMENTS="$MAC_ENTITLEMENTS"',
      'CSC_NAME=TEST-IDENTITY',
      'codesign() {',
      '  case "$1" in',
      '    --sign)',
      '      printf \'SIGN\' >> "$codesign_log"',
      '      printf \' <%s>\' "$@" >> "$codesign_log"',
      '      printf \'\\n\' >> "$codesign_log"',
      '      ;;',
      '    --verify) ;;',
      '    -d) cat "$MAC_ENTITLEMENTS" ;;',
      '    *) return 2 ;;',
      '  esac',
      '}',
      'finalize_mac_bundle "$app"',
      'cat "$codesign_log"'
    ].join('\n')], { encoding: 'utf8' })
    const records = output.trim().split('\n')
    const embeddedSign = records.find(line => line.endsWith('/pipiui-embedded/node/bin/node>'))
    const genericSign = records.find(line => line.endsWith('/Contents/Resources/native-helper>'))
    expect(embeddedSign).toContain(` <--entitlements> <${entitlementsPath}>`)
    expect(genericSign).toBeDefined()
    expect(genericSign).not.toContain('<--entitlements>')
  }, 15_000)

  it('fails finalization when the signed embedded Node lacks allow-jit', () => {
    if (process.platform !== 'darwin') return
    const scriptPath = resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh')
    const entitlementsPath = resolve(import.meta.dirname, '../../node_modules/app-builder-lib/templates/entitlements.mac.plist')
    const result = spawnSync('/bin/bash', ['-c', [
      'set -euo pipefail',
      'fixture="$(mktemp -d)"',
      'trap \'rm -rf "$fixture"\' EXIT',
      'app="$fixture/Test.app"',
      'embedded_node="$app/Contents/Resources/pipiui-embedded/node/bin/node"',
      'mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks/Electron Framework.framework"',
      'mkdir -p "$app/Contents/Resources/cua-driver" "$(dirname "$embedded_node")"',
      'mkdir -p "$app/Contents/Resources/pipiui-runtime"',
      `cp ${JSON.stringify(process.execPath)} "$app/Contents/MacOS/PipiUI Electron"`,
      `cp ${JSON.stringify(process.execPath)} "$app/Contents/Resources/cua-driver/cua-driver"`,
      `cp ${JSON.stringify(process.execPath)} "$embedded_node"`,
      'chmod +x "$app/Contents/MacOS/PipiUI Electron" "$app/Contents/Resources/cua-driver/cua-driver" "$embedded_node"',
      `eval "$(sed '/^PLATFORM=/,$d' ${JSON.stringify(scriptPath)})"`,
      `MAC_ENTITLEMENTS=${JSON.stringify(entitlementsPath)}`,
      'MAC_INHERIT_ENTITLEMENTS="$MAC_ENTITLEMENTS"',
      'CSC_NAME=TEST-IDENTITY',
      'codesign() {',
      '  case "$1" in',
      '    --sign|--verify) return 0 ;;',
      '    -d)',
      '      printf \'%s\\n\' \'<?xml version="1.0" encoding="UTF-8"?>\' \'<plist version="1.0"><dict></dict></plist>\'',
      '      ;;',
      '    *) return 2 ;;',
      '  esac',
      '}',
      'finalize_mac_bundle "$app"'
    ].join('\n')], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('embedded Node is missing required com.apple.security.cs.allow-jit entitlement')
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

  it('matches only the exact canonical Electron executable and guards before mac build work', () => {
    const scriptPath = resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh')
    const result = spawnSync('/bin/bash', ['-c', [
      'set -euo pipefail',
      `eval "$(sed '/^PLATFORM=/,$d' ${JSON.stringify(scriptPath)})"`,
      'target="/workspace/build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron"',
      'printf \' 42 %s\\n\' "$target" | process_list_contains_exact_executable "$target"',
      'if printf \' 43 %s Helper\\n\' "$target" | process_list_contains_exact_executable "$target"; then exit 41; fi',
      'if printf \' 44 /other/PipiUI Electron.app/Contents/MacOS/PipiUI Electron\\n\' | process_list_contains_exact_executable "$target"; then exit 42; fi',
    ].join('\n')], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(wrapper).toContain('CANONICAL_ELECTRON_EXECUTABLE="$ROOT/build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron"')
    expect(wrapper).toMatch(/canonical_electron_app_is_running "\$CANONICAL_ELECTRON_EXECUTABLE"[\s\S]*exit 1[\s\S]*prepare_mac_signing_identity/)
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
