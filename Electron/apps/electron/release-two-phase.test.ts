import { describe, expect, it } from 'vitest'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

// Two-phase full-release contract: `build-electron-app.sh mac --stage-only`
// (stage while PipiUI stays open) and the repo installer
// scripts/install-electron-release-staged.sh (atomic swap with rollback).
// Everything executable runs against temp fake roots and command seams; the
// real canonical App is never touched by this file.
const buildScript = readFileSync(resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh'), 'utf8')
const installerSource = readFileSync(resolve(import.meta.dirname, '../../../scripts/install-electron-release-staged.sh'), 'utf8')
const installerPath = resolve(import.meta.dirname, '../../../scripts/install-electron-release-staged.sh')
const buildScriptPath = resolve(import.meta.dirname, '../../../scripts/build-electron-app.sh')
const darwin = process.platform === 'darwin'

const infoPlist = (version: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>
`

/** Lay down a fake staged-release App tree (main exe, Info.plist, OfficeCLI slice+receipt). */
function fakeAppBundle(appDir: string, marker: string, version = '1.2.3') {
  const officeDir = join(appDir, 'Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64')
  mkdirSync(join(appDir, 'Contents/MacOS'), { recursive: true })
  mkdirSync(officeDir, { recursive: true })
  const exe = join(appDir, 'Contents/MacOS/PipiUI Electron')
  writeFileSync(exe, `#!/bin/sh\n# ${marker}\n`)
  chmodSync(exe, 0o755)
  writeFileSync(join(appDir, 'Contents/marker'), marker)
  writeFileSync(join(appDir, 'Contents/Info.plist'), infoPlist(version))
  const officeBody = `officecli-${marker}\n`
  const officeBin = join(officeDir, 'officecli')
  writeFileSync(officeBin, officeBody)
  chmodSync(officeBin, 0o755)
  const sha256 = createHash('sha256').update(officeBody).digest('hex')
  writeFileSync(join(officeDir, 'receipt.json'), `${JSON.stringify({
    version: '0.5.0',
    asset: 'officecli-darwin-arm64',
    sha256,
    target: 'darwin-arm64',
    bytes: Buffer.byteLength(officeBody)
  }, null, 2)}\n`)
  const extDir = join(appDir, 'Contents/Resources/pipiui-runtime/extensions/office-extension')
  mkdirSync(extDir, { recursive: true })
  writeFileSync(join(extDir, 'pipiui-extension.json'), JSON.stringify({ id: 'office-extension', version: '0.1.0' }))
  return { sha256, bytes: Buffer.byteLength(officeBody) }
}

const sha256OfFile = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

function extensionManifestAggregate(appDir: string) {
  const extRoot = join(appDir, 'Contents/Resources/pipiui-runtime/extensions')
  const rels: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'pipiui-extension.json') rels.push(p.slice(appDir.length + 1).split('\\').join('/'))
    }
  }
  if (existsSync(extRoot)) walk(extRoot)
  rels.sort()
  const lines = rels.map(rel => `${rel}  ${sha256OfFile(join(appDir, rel))}`)
  return {
    count: rels.length,
    aggregateSha256: createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex')
  }
}

function writeReleaseArtifacts(root: string, version = '1.2.3') {
  const artifacts: Array<{ kind: string; arch: string; path: string; bytes: number; sha256: string }> = []
  for (const arch of ['arm64', 'x64'] as const) {
    for (const kind of ['dmg', 'zip'] as const) {
      const path = join(root, 'build', `PipiUI Electron-${version}-${arch}.${kind}`)
      const body = `${kind}-${arch}-${version}\n`
      writeFileSync(path, body)
      artifacts.push({
        kind, arch, path,
        bytes: Buffer.byteLength(body),
        sha256: createHash('sha256').update(body).digest('hex')
      })
    }
  }
  return artifacts
}

const DEFAULT_TEST_CDHASH = `${'a'.repeat(63)}b`
const stagedContainerOf = (root: string) => join(root, 'build/PipiUI Electron.release-staged')
const stagedReceiptOf = (root: string) => join(stagedContainerOf(root), 'receipt.json')
const stagedAppOf = (root: string) => join(stagedContainerOf(root), 'PipiUI Electron.app')

function writeStagedReceipt(root: string, appDir: string, sha256: string, bytes: number, over: Record<string, unknown> = {}) {
  const container = stagedContainerOf(root)
  const stagedPath = stagedAppOf(root)
  mkdirSync(container, { recursive: true })
  const exe = join(appDir, 'Contents/MacOS/PipiUI Electron')
  const plist = join(appDir, 'Contents/Info.plist')
  const officeReceipt = join(appDir, 'Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/receipt.json')
  const manifests = extensionManifestAggregate(appDir)
  const artifacts = Array.isArray(over.artifacts) ? over.artifacts : writeReleaseArtifacts(root)
  const cdhash = typeof over.cdhash === 'string' ? over.cdhash : DEFAULT_TEST_CDHASH
  const { cdhash: _ignoredCdhash, artifacts: _ignoredArtifacts, app: appOver, officecli: officeOver, codesign: codesignOver, ...topOver } = over
  const receipt = {
    schema: 'pipiui-electron-release-staged/2',
    sourceScriptVersion: '2',
    version: '1.2.3',
    containerPath: container,
    stagedPath,
    mainArch: 'arm64',
    stagedAt: new Date().toISOString(),
    stagedAtEpoch: Math.floor(Date.now() / 1000),
    app: {
      cdhash,
      mainExecutable: {
        path: 'Contents/MacOS/PipiUI Electron',
        sha256: sha256OfFile(exe),
        bytes: statSync(exe).size
      },
      infoPlist: {
        path: 'Contents/Info.plist',
        sha256: sha256OfFile(plist)
      },
      extensionManifests: manifests,
      ...(appOver && typeof appOver === 'object' ? appOver as Record<string, unknown> : {})
    },
    officecli: {
      target: 'darwin-arm64',
      sha256,
      bytes,
      version: '0.5.0',
      receiptPath: 'Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/receipt.json',
      receiptSha256: sha256OfFile(officeReceipt),
      ...(officeOver && typeof officeOver === 'object' ? officeOver as Record<string, unknown> : {})
    },
    codesign: {
      verified: true,
      mode: 'deep-strict',
      cdhash,
      ...(codesignOver && typeof codesignOver === 'object' ? codesignOver as Record<string, unknown> : {})
    },
    artifacts,
    ...topOver
  }
  writeFileSync(join(container, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

/** Temp dir whose absolute path has no symlink ancestors (macOS /tmp and /var are symlinks). */
function physicalMkTemp(prefix: string) {
  mkdirSync('/private/tmp', { recursive: true })
  return mkdtempSync(join('/private/tmp', prefix))
}

/** A full fake release root: staged app + receipt + old canonical App + seams. */
function makeReleaseFixture() {
  const root = physicalMkTemp('pipiui-release-two-phase.XXXXXX')
  mkdirSync(join(root, 'build'), { recursive: true })
  const stagedDir = stagedAppOf(root)
  const office = fakeAppBundle(stagedDir, 'staged-candidate')
  writeStagedReceipt(root, stagedDir, office.sha256, office.bytes)
  fakeAppBundle(join(root, 'build/PipiUI Electron.app'), 'old-canonical', '1.2.2')
  const seams = makeSeams(root)
  return { root, stagedDir, seams, ...seams }
}

/** Command seams for the installer. Every binary the installer may invoke on a
 * live system is replaced; plutil/shasum/stat run for real against fake files. */
function makeSeams(root: string) {
  const dir = physicalMkTemp('pipiui-release-seams.XXXXXX')
  const stateFile = join(dir, 'ps-state')
  const rootFile = join(dir, 'root')
  const codesignModeFile = join(dir, 'codesign-mode')
  const codesignCdhashFile = join(dir, 'codesign-cdhash')
  const lipoOutFile = join(dir, 'lipo-out')
  const osascriptNoFlipFile = join(dir, 'osascript-noflip')
  writeFileSync(stateFile, 'empty')
  writeFileSync(rootFile, root)
  writeFileSync(codesignModeFile, 'ok')
  writeFileSync(codesignCdhashFile, `${'a'.repeat(63)}b`)
  writeFileSync(lipoOutFile, 'arm64')
  const write = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`)
    chmodSync(join(dir, name), 0o755)
  }
  write('ps', `
state="$(cat "${stateFile}")"
exe="$(cat "${rootFile}")/build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron"
if [[ "\${2:-}" == "-p" ]]; then
  case "$state" in
    running|running-after-open) echo "$exe" ;;
    reproof-flip) echo "/usr/local/bin/totally-unrelated-binary" ;;
  esac
  exit 0
fi
case "$state" in
  running|reproof-flip) echo "4242 $exe" ;;
  running-after-open) echo "777 $exe" ;;
esac
exit 0`)
  write('osascript', `
echo "osascript $*" >> "${dir}/osascript.calls"
if [[ ! -f "${osascriptNoFlipFile}" ]]; then echo empty > "${stateFile}"; fi
exit 0`)
  write('kill', `
echo "kill $*" >> "${dir}/kill.calls"
if [[ "$1" == "-TERM" || "$1" == "-KILL" ]] && [[ "$2" == "4242" ]]; then echo empty > "${stateFile}"; fi
exit 0`)
  write('codesign', `
echo "codesign $*" >> "${dir}/codesign.calls"
mode="$(cat "${codesignModeFile}")"
target="${'${!#}'}"
case "$mode" in
  ok) ;;
  always-fail) exit 1 ;;
  fail-mac-arm64) [[ "$target" == *"mac-arm64"* ]] && exit 1; exit 0 ;;
  fail-canonical) if [[ "$target" != *"release-staged"* && "$target" == *"/build/PipiUI Electron.app" ]]; then exit 1; fi ;;
esac
if [[ "$1" == "-d" ]]; then
  printf 'CDHash=%s\\n' "$(cat "${codesignCdhashFile}")"
fi
exit 0`)
  write('lipo', `echo "$(cat "${lipoOutFile}")"`)
  write('lsregister', `
echo "lsregister $*" >> "${dir}/lsregister.calls"
if [[ "\${1:-}" == "-dump" ]]; then
  printf -- '%s\\n' "--------------------"
  printf 'path:          %s\\n' "$(cat "${rootFile}")/build/PipiUI Electron.app"
  printf 'identifier:    com.leehow.pipiui-electron\\n'
fi
exit 0`)
  write('open', `
echo "open $*" >> "${dir}/open.calls"
echo running-after-open > "${stateFile}"
exit 0`)
  write('lsof', `printf 'n%s\\n' "$(cat "${rootFile}")/build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron"`)
  const trash = join(dir, 'Trash')
  mkdirSync(trash, { recursive: true })
  const envFor = (over: Record<string, string> = {}) => ({
    ...process.env,
    PS_BIN: join(dir, 'ps'),
    OSASCRIPT_BIN: join(dir, 'osascript'),
    KILL_BIN: join(dir, 'kill'),
    CODESIGN_BIN: join(dir, 'codesign'),
    LIPO_BIN: join(dir, 'lipo'),
    LSREGISTER_BIN: join(dir, 'lsregister'),
    OPEN_BIN: join(dir, 'open'),
    LSOF_BIN: join(dir, 'lsof'),
    PIPIUI_INSTALLER_TEST_MODE: '1',
    PIPIUI_INSTALLER_TRASH_DIR: trash,
    PIPIUI_INSTALL_GRACE_ATTEMPTS: '20',
    PIPIUI_INSTALL_TERM_ATTEMPTS: '2',
    PIPIUI_INSTALL_KILL_ATTEMPTS: '2',
    ...over
  })
  const runInstaller = (args: string[], over: Record<string, string> = {}) =>
    spawnSync('/bin/bash', [installerPath, ...args], { encoding: 'utf8', env: envFor(over) })
  const calls = (name: string) => {
    const file = join(dir, `${name}.calls`)
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }
  return {
    dir, trash, stateFile, codesignModeFile, lipoOutFile, osascriptNoFlipFile,
    envFor, runInstaller, calls,
    get cdhash() { return readFileSync(codesignCdhashFile, 'utf8').trim() },
    setCdhash: (h: string) => writeFileSync(codesignCdhashFile, h),
    setState: (s: string) => writeFileSync(stateFile, s),
    setCodesign: (m: string) => writeFileSync(codesignModeFile, m),
    setLipo: (s: string) => writeFileSync(lipoOutFile, s)
  }
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe('two-phase release: build script stage-only contract', () => {
  it('documents and parses mac --stage-only, rejecting unknown second arguments', () => {
    const help = spawnSync('/bin/bash', [buildScriptPath, '-h'], { encoding: 'utf8' })
    expect(help.status, help.stderr).toBe(0)
    expect(help.stdout).toContain('--stage-only')
    expect(help.stdout).toContain('PipiUI Electron.release-staged/')
    expect(help.stdout).toContain('receipt.json')
    expect(spawnSync('/bin/bash', [buildScriptPath, 'win', '--stage-only'], { encoding: 'utf8' }).status).toBe(2)
    expect(spawnSync('/bin/bash', [buildScriptPath, 'mac', '--bogus'], { encoding: 'utf8' }).status).toBe(2)
    expect(spawnSync('/bin/bash', [buildScriptPath, 'linux', 'extra'], { encoding: 'utf8' }).status).toBe(2)
  })

  // ---- top-level route harness -------------------------------------------
  // The route is executed for real against a fake repo root placed inside the
  // primary checkout (so the primary-checkout guard still sees the primary
  // git root), with the script's own function-test seams disabling only the
  // heavyweight steps (workspace build, icon, keychain, electron-builder).
  const repoRoot = resolve(import.meta.dirname, '../../..')
  const routeTmpBase = join(repoRoot, '.tmp')

  it('allocates unique builder logs from the real BSD-legal mktemp template', () => {
    if (!darwin) return
    const match = /log="\$\(mktemp "([^"]+)"\)"/.exec(buildScript)
    expect(match?.[1], 'package_mac_arch must allocate its builder log via mktemp').toBeTruthy()
    const template = match![1]
    mkdirSync(routeTmpBase, { recursive: true })
    const work = mkdtempSync(join(routeTmpBase, 'builder-log.XXXXXX'))
    try {
      const output = execFileSync('/bin/bash', ['-c', [
        'set -euo pipefail',
        `export TMPDIR=${JSON.stringify(work)}`,
        'arch=x64',
        `a=$(mktemp "${template}")`,
        `b=$(mktemp "${template}")`,
        'printf "%s\n%s\n" "$a" "$b"'
      ].join('\n')], { encoding: 'utf8' })
      const [first, second] = output.trim().split('\n')
      expect(first).not.toBe(second)
      expect(existsSync(first)).toBe(true)
      expect(existsSync(second)).toBe(true)
      expect(first.startsWith(`${work}/`)).toBe(true)
      expect(second.startsWith(`${work}/`)).toBe(true)
      expect(first).toMatch(/pipiui-electron-builder-x64\.log\.[A-Za-z0-9]{6}$/)
      expect(second).toMatch(/pipiui-electron-builder-x64\.log\.[A-Za-z0-9]{6}$/)
      expect(first).not.toContain('XXXXXX')
      expect(second).not.toContain('XXXXXX')
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  /** A complete fake candidate bundle: satisfies expected_mac_bundle_is_complete,
   * strict-verification identity (Info.plist, marker), and receipt binding. */
  function fakeCompleteBundle(appDir: string, marker: string, version = '1.2.3') {
    const c = join(appDir, 'Contents')
    const officeDir = join(c, 'Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64')
    mkdirSync(join(c, 'MacOS'), { recursive: true })
    mkdirSync(join(c, 'Frameworks/Electron Framework.framework'), { recursive: true })
    mkdirSync(join(c, 'Resources/cua-driver'), { recursive: true })
    mkdirSync(join(c, 'Resources/pipiui-embedded/node/bin'), { recursive: true })
    mkdirSync(join(c, 'Resources/pipiui-runtime/extensions/deepseek'), { recursive: true })
    mkdirSync(officeDir, { recursive: true })
    const exe = join(c, 'MacOS/PipiUI Electron')
    writeFileSync(exe, `#!/bin/sh\n# ${marker}\n`)
    chmodSync(exe, 0o755)
    writeFileSync(join(c, 'marker'), marker)
    writeFileSync(join(c, 'Info.plist'), infoPlist(version))
    const driver = join(c, 'Resources/cua-driver/cua-driver')
    writeFileSync(driver, `driver-${marker}\n`)
    chmodSync(driver, 0o755)
    const node = join(c, 'Resources/pipiui-embedded/node/bin/node')
    writeFileSync(node, `node-${marker}\n`)
    chmodSync(node, 0o755)
    writeFileSync(join(c, 'Resources/pipiui-runtime/extensions/deepseek/pipiui-extension.json'), JSON.stringify({ id: 'deepseek', version: '9.9.9' }))
    writeFileSync(join(c, 'Resources/pipiui-runtime/extensions/office-extension/pipiui-extension.json'), JSON.stringify({ id: 'office-extension', version: '0.1.0' }))
    const officeBody = `OFFICEMARKER-${marker}\n`
    const officeBin = join(officeDir, 'office' + 'cli')
    writeFileSync(officeBin, officeBody)
    chmodSync(officeBin, 0o755)
    const sha256 = createHash('sha256').update(officeBody).digest('hex')
    writeFileSync(join(officeDir, 'receipt.json'), `${JSON.stringify({ version: '0.5.0', sha256, target: 'darwin-arm64', bytes: officeBody.length }, null, 2)}\n`)
    return { sha256, bytes: officeBody.length }
  }

  function makeRouteHarness() {
    mkdirSync(routeTmpBase, { recursive: true })
    const root = mkdtempSync(join(routeTmpBase, 'release-route.XXXXXX'))
    mkdirSync(join(root, 'scripts'), { recursive: true })
    mkdirSync(join(root, 'build'), { recursive: true })
    copyFileSync(buildScriptPath, join(root, 'scripts/build-electron-app.sh'))
    const seams = makeSeams(root)
    const fixtureApp = join(root, 'fixture/PipiUI Electron.app')
    fakeCompleteBundle(fixtureApp, 'route-candidate', '1.2.3')
    const psListingFile = join(seams.dir, 'ps-listing')
    writeFileSync(psListingFile, '')
    const run = (args: string[], over: Record<string, string> = {}) =>
      spawnSync('/bin/bash', [join(root, 'scripts/build-electron-app.sh'), ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${seams.dir}:${process.env.PATH ?? ''}`,
          PIPIUI_ELECTRON_RELEASE_FUNCTION_TEST: '1',
          PIPIUI_ELECTRON_PACKAGING_FUNCTION_TEST: '1',
          PIPIUI_PACKAGING_TEST_FIXTURE: fixtureApp,
          PIPIUI_PACKAGING_TEST_VERSION: '1.2.3',
          PIPIUI_PS_SEAM_FILE: psListingFile,
          ...over
        }
      })
    const setRunning = (running: boolean) =>
      writeFileSync(psListingFile, running ? `  4242 ${root}/build/PipiUI Electron.app/Contents/MacOS/PipiUI Electron\n` : '')
    return { root, seams, run, setRunning, fixtureApp }
  }

  const containerOf = (root: string) => join(root, 'build/PipiUI Electron.release-staged')
  const buildEntries = (root: string, prefix: string) =>
    readdirSync(join(root, 'build')).filter(name => name.startsWith(prefix))
  const sha256OfFile = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

  it('splits the running-canonical gate: plain mac refuses while canonical runs, stage-only proceeds', { timeout: 30_000 }, () => {
    if (!darwin) return
    const h = makeRouteHarness()
    try {
      fakeCompleteBundle(join(h.root, 'build/PipiUI Electron.app'), 'old-canonical', '1.2.2')
      h.setRunning(true)
      const plain = h.run(['mac'])
      expect(plain.status).toBe(1)
      expect(plain.stderr).toContain('refusing to build or replace the canonical Electron App while it is running')
      expect(plain.stdout).not.toContain('Release run root')
      expect(plain.stdout).not.toContain('Packaged:')
      expect(buildEntries(h.root, '.release-run')).toEqual([])

      const staged = h.run(['mac', '--stage-only'])
      expect(staged.status, staged.stderr).toBe(0)
      expect(readFileSync(join(h.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
      expect(existsSync(join(containerOf(h.root), 'receipt.json'))).toBe(true)
      expect(readFileSync(join(containerOf(h.root), 'PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('route-candidate')
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('plain mac remains the canonical install and never creates a staged container', { timeout: 30_000 }, () => {
    if (!darwin) return
    const h = makeRouteHarness()
    try {
      fakeCompleteBundle(join(h.root, 'build/PipiUI Electron.app'), 'old-canonical', '1.2.2')
      const result = h.run(['mac'])
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('Packaged:')
      expect(readFileSync(join(h.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('route-candidate')
      expect(existsSync(containerOf(h.root))).toBe(false)
      expect(readdirSync(join(h.root, 'build')).filter(name => /\.(dmg|zip)$/.test(name)).sort()).toEqual([
        'PipiUI Electron-1.2.3-arm64.dmg',
        'PipiUI Electron-1.2.3-arm64.zip',
        'PipiUI Electron-1.2.3-x64.dmg',
        'PipiUI Electron-1.2.3-x64.zip'
      ])
      expect(buildEntries(h.root, '.release-run')).toEqual([])
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('uses a unique owned run root per release and never deletes fixed build/mac* trees', { timeout: 30_000 }, () => {
    if (!darwin) return
    const h = makeRouteHarness()
    try {
      mkdirSync(join(h.root, 'build/mac'), { recursive: true })
      mkdirSync(join(h.root, 'build/mac-arm64'), { recursive: true })
      writeFileSync(join(h.root, 'build/mac/sentinel'), 'keep')
      writeFileSync(join(h.root, 'build/mac-arm64/sentinel'), 'keep')
      const first = h.run(['mac', '--stage-only'])
      const second = h.run(['mac', '--stage-only'])
      expect(first.status, first.stderr).toBe(0)
      expect(second.status, second.stderr).toBe(0)
      const runRootOf = (out: string) => /Release run root: (.*)/.exec(out)?.[1] ?? ''
      const root1 = runRootOf(first.stdout)
      const root2 = runRootOf(second.stdout)
      expect(root1).toMatch(/\/build\/\.release-run\./)
      expect(root2).toMatch(/\/build\/\.release-run\./)
      expect(root1).not.toBe(root2)
      expect(existsSync(root1)).toBe(false)
      expect(existsSync(root2)).toBe(false)
      expect(buildEntries(h.root, '.release-run')).toEqual([])
      expect(buildEntries(h.root, '.release-staged-container')).toEqual([])
      expect(buildEntries(h.root, '.PipiUI')).toEqual([])
      expect(readFileSync(join(h.root, 'build/mac/sentinel'), 'utf8')).toBe('keep')
      expect(readFileSync(join(h.root, 'build/mac-arm64/sentinel'), 'utf8')).toBe('keep')
      expect(readFileSync(join(containerOf(h.root), 'PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('route-candidate')
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('publishes only the exact current-run 4-artifact matrix; a bad matrix fails before build/ is touched', { timeout: 30_000 }, () => {
    if (!darwin) return
    const h = makeRouteHarness()
    try {
      writeFileSync(join(h.root, 'build/PipiUI Electron-0.9.9-arm64.dmg'), 'old release dmg\n')
      const ok = h.run(['mac', '--stage-only'])
      expect(ok.status, ok.stderr).toBe(0)
      const goodDmg = readFileSync(join(h.root, 'build/PipiUI Electron-1.2.3-arm64.dmg'), 'utf8')
      const firstReceipt = readFileSync(join(containerOf(h.root), 'receipt.json'), 'utf8')

      const missing = h.run(['mac', '--stage-only'], { PIPIUI_PACKAGING_TEST_SKIP: 'arm64-zip' })
      expect(missing.status).not.toBe(0)
      expect(missing.stderr).toContain('expected exactly 4 artifacts')

      const duplicate = h.run(['mac', '--stage-only'], { PIPIUI_PACKAGING_TEST_EXTRA_ARM64: 'PipiUI Electron-1.2.3-arm64-2.dmg' })
      expect(duplicate.status).not.toBe(0)
      expect(duplicate.stderr).toContain('duplicate arm64 dmg artifact')

      const wrongVersion = h.run(['mac', '--stage-only'], { PIPIUI_PACKAGING_TEST_EXTRA_ARM64: 'PipiUI Electron-0.0.1-arm64.dmg' })
      expect(wrongVersion.status).not.toBe(0)
      expect(wrongVersion.stderr).toContain('not tagged with the release version 1.2.3')

      for (const failed of [missing, duplicate, wrongVersion]) {
        expect(failed.stdout).not.toContain('Staged release container')
      }
      // Prior artifacts and prior staged container intact; no leftovers.
      expect(readFileSync(join(h.root, 'build/PipiUI Electron-1.2.3-arm64.dmg'), 'utf8')).toBe(goodDmg)
      expect(readFileSync(join(h.root, 'build/PipiUI Electron-0.9.9-arm64.dmg'), 'utf8')).toBe('old release dmg\n')
      expect(readFileSync(join(containerOf(h.root), 'receipt.json'), 'utf8')).toBe(firstReceipt)
      expect(buildEntries(h.root, '.release-run')).toEqual([])
      expect(buildEntries(h.root, '.PipiUI')).toEqual([])
      expect(buildEntries(h.root, '.release-staged-container')).toEqual([])
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('keeps the previous complete container pair when the new candidate fails verification', { timeout: 30_000 }, () => {
    if (!darwin) return
    const h = makeRouteHarness()
    try {
      const first = h.run(['mac', '--stage-only'])
      expect(first.status, first.stderr).toBe(0)
      const firstReceipt = readFileSync(join(containerOf(h.root), 'receipt.json'), 'utf8')
      const fixture2 = join(h.root, 'fixture2/PipiUI Electron.app')
      fakeCompleteBundle(fixture2, 'route-candidate-2', '1.2.3')

      // Strict codesign failure on the new candidate: previous pair kept.
      h.seams.setCodesign('fail-mac-arm64')
      const failed = h.run(['mac', '--stage-only'], { PIPIUI_PACKAGING_TEST_FIXTURE: fixture2 })
      expect(failed.status).not.toBe(0)
      expect(failed.stderr).toContain('strict codesign verification failed')
      expect(readFileSync(join(containerOf(h.root), 'receipt.json'), 'utf8')).toBe(firstReceipt)
      expect(readFileSync(join(containerOf(h.root), 'PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('route-candidate')

      // OfficeCLI hash drift in the new candidate: same guarantee.
      h.seams.setCodesign('ok')
      writeFileSync(join(fixture2, 'Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/' + 'office' + 'cli'), 'tampered\n')
      const failedHash = h.run(['mac', '--stage-only'], { PIPIUI_PACKAGING_TEST_FIXTURE: fixture2 })
      expect(failedHash.status).not.toBe(0)
      expect(failedHash.stderr).toContain('OfficeCLI')
      expect(readFileSync(join(containerOf(h.root), 'receipt.json'), 'utf8')).toBe(firstReceipt)
      expect(readFileSync(join(containerOf(h.root), 'PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('route-candidate')
      expect(buildEntries(h.root, '.PipiUI')).toEqual([])
      expect(buildEntries(h.root, '.release-staged-container')).toEqual([])

      // A healthy second candidate atomically replaces the first pair.
      fakeCompleteBundle(fixture2, 'route-candidate-2', '1.2.3')
      const second = h.run(['mac', '--stage-only'], { PIPIUI_PACKAGING_TEST_FIXTURE: fixture2 })
      expect(second.status, second.stderr).toBe(0)
      expect(readFileSync(join(containerOf(h.root), 'PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('route-candidate-2')
      expect(readJson(join(containerOf(h.root), 'receipt.json')).version).toBe('1.2.3')
      expect(buildEntries(h.root, '.PipiUI')).toEqual([])
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })

  it('binds receipt schema v2 to the exact verified candidate and artifact set', { timeout: 30_000 }, () => {
    if (!darwin) return
    const h = makeRouteHarness()
    try {
      const result = h.run(['mac', '--stage-only'])
      expect(result.status, result.stderr).toBe(0)
      const container = containerOf(h.root)
      const staged = join(container, 'PipiUI Electron.app')
      const receipt = readJson(join(container, 'receipt.json'))
      expect(receipt.schema).toBe('pipiui-electron-release-staged/2')
      expect(receipt.sourceScriptVersion).toBe('2')
      expect(receipt.version).toBe('1.2.3')
      expect(receipt.mainArch).toBe('arm64')
      expect(receipt.containerPath).toBe(container)
      expect(receipt.stagedPath).toBe(staged)
      // Strict codesign identity: the CDHash emitted by `codesign -d`.
      expect(receipt.app.cdhash).toBe(h.seams.cdhash)
      expect(receipt.codesign).toEqual({ verified: true, mode: 'deep-strict', cdhash: h.seams.cdhash })
      // Main executable and Info.plist hashes.
      const exe = join(staged, 'Contents/MacOS/PipiUI Electron')
      expect(receipt.app.mainExecutable.sha256).toBe(sha256OfFile(exe))
      expect(receipt.app.mainExecutable.bytes).toBe(statSync(exe).size)
      expect(receipt.app.infoPlist.sha256).toBe(sha256OfFile(join(staged, 'Contents/Info.plist')))
      // Extension-manifest aggregate: same deterministic algorithm as the script.
      const manifestRels = [
        'Contents/Resources/pipiui-runtime/extensions/deepseek/pipiui-extension.json',
        'Contents/Resources/pipiui-runtime/extensions/office-extension/pipiui-extension.json'
      ].sort()
      const aggregate = createHash('sha256')
        .update(manifestRels.map(rel => `${rel}  ${sha256OfFile(join(staged, rel))}`).join('\n') + '\n')
        .digest('hex')
      expect(receipt.app.extensionManifests).toEqual({ count: 2, aggregateSha256: aggregate })
      // OfficeCLI binary + receipt binding.
      const officeDir = join(staged, 'Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64')
      expect(receipt.officecli.target).toBe('darwin-arm64')
      expect(receipt.officecli.sha256).toBe(sha256OfFile(join(officeDir, 'office' + 'cli')))
      expect(receipt.officecli.bytes).toBe(statSync(join(officeDir, 'office' + 'cli')).size)
      expect(receipt.officecli.receiptSha256).toBe(sha256OfFile(join(officeDir, 'receipt.json')))
      // Exact artifact matrix with recorded size + sha256 over the published files.
      const artifacts = [...receipt.artifacts].sort((a: { kind: string; arch: string }, b: { kind: string; arch: string }) => `${a.kind}-${a.arch}`.localeCompare(`${b.kind}-${b.arch}`))
      expect(artifacts.map((a: { kind: string; arch: string }) => `${a.kind}-${a.arch}`)).toEqual(['dmg-arm64', 'dmg-x64', 'zip-arm64', 'zip-x64'])
      for (const artifact of artifacts) {
        expect(artifact.path).toBe(join(h.root, 'build', `PipiUI Electron-1.2.3-${artifact.arch}.${artifact.kind}`))
        expect(existsSync(artifact.path)).toBe(true)
        expect(artifact.bytes).toBe(statSync(artifact.path).size)
        expect(artifact.sha256).toBe(sha256OfFile(artifact.path))
      }
    } finally {
      rmSync(h.root, { recursive: true, force: true })
    }
  })
})

describe('two-phase release: repo installer contract', () => {
  it('never deletes recursively and never matches processes by name', () => {
    expect(installerSource).not.toMatch(/rm -rf/)
    expect(installerSource).not.toContain('pkill')
    expect(installerSource).not.toContain('killall')
    expect(installerSource).toMatch(/pid_is_canonical_process "\$pid"/)
    expect(installerSource).toContain('PipiUI Electron.release-staged/')
    expect(installerSource).toContain('receipt.json')
    expect(installerSource).toContain('pipiui-electron-release-staged/2')
    expect(installerSource).not.toContain('PipiUI Electron.release-staged.app')
    expect(installerSource).toContain('[[ -L ')
    expect(installerSource).toContain('walk_absolute_path')
    expect(installerSource).toContain('PIPIUI_INSTALLER_TEST_MODE')
    expect(installerSource).toContain('PipiUI Electron.release-install.json')
    expect(installerSource).toContain('PipiUI Electron.release-install.log')
  })

  it('rejects every invalid staged candidate before touching anything', { timeout: 20_000 }, () => {
    if (!darwin) return
    const rewriteReceipt = (f: ReturnType<typeof makeReleaseFixture>, over: Record<string, unknown>) => {
      const receipt = readJson(stagedReceiptOf(f.root))
      writeFileSync(stagedReceiptOf(f.root), JSON.stringify({ ...receipt, ...over }))
    }
    const cases: Array<{ name: string; mutate: (f: ReturnType<typeof makeReleaseFixture>) => void; expectError: string; writesReceipt?: boolean }> = [
      {
        name: 'missing receipt',
        mutate: f => rmSync(stagedReceiptOf(f.root)),
        expectError: 'staged receipt',
        writesReceipt: false
      },
      {
        name: 'wrong schema',
        mutate: f => rewriteReceipt(f, { schema: 'bogus/9' }),
        expectError: 'schema'
      },
      {
        name: 'legacy schema /1',
        mutate: f => rewriteReceipt(f, { schema: 'pipiui-electron-release-staged/1' }),
        expectError: 'schema'
      },
      {
        name: 'non-arm64 main arch',
        mutate: f => f.setLipo('x86_64'),
        expectError: 'arm64'
      },
      {
        name: 'officecli hash mismatch',
        mutate: f => {
          writeFileSync(join(f.stagedDir, 'Contents/Resources/pipiui-runtime/extensions/office-extension/bin/darwin-arm64/officecli'), 'tampered\n')
        },
        expectError: 'OfficeCLI'
      },
      {
        name: 'officecli version mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({
            ...receipt,
            officecli: { ...receipt.officecli, version: '9.9.9' }
          }))
        },
        expectError: 'OfficeCLI version'
      },
      {
        name: 'officecli receipt hash mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({
            ...receipt,
            officecli: { ...receipt.officecli, receiptSha256: 'b'.repeat(64) }
          }))
        },
        expectError: 'receiptSha256'
      },
      {
        name: 'staged codesign failure',
        mutate: f => f.setCodesign('always-fail'),
        expectError: 'codesign'
      },
      {
        name: 'cdhash mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          const bad = 'c'.repeat(64)
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({
            ...receipt,
            app: { ...receipt.app, cdhash: bad },
            codesign: { ...receipt.codesign, cdhash: bad }
          }))
        },
        expectError: 'CDHash'
      },
      {
        name: 'main executable hash mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({
            ...receipt,
            app: {
              ...receipt.app,
              mainExecutable: { ...receipt.app.mainExecutable, sha256: 'd'.repeat(64) }
            }
          }))
        },
        expectError: 'main executable hash'
      },
      {
        name: 'Info.plist hash mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({
            ...receipt,
            app: {
              ...receipt.app,
              infoPlist: { ...receipt.app.infoPlist, sha256: 'e'.repeat(64) }
            }
          }))
        },
        expectError: 'Info.plist hash'
      },
      {
        name: 'manifest aggregate mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({
            ...receipt,
            app: {
              ...receipt.app,
              extensionManifests: { ...receipt.app.extensionManifests, aggregateSha256: 'f'.repeat(64) }
            }
          }))
        },
        expectError: 'manifest aggregate'
      },
      {
        name: 'artifact inventory hash mismatch',
        mutate: f => {
          const receipt = readJson(stagedReceiptOf(f.root))
          const artifacts = [...receipt.artifacts]
          artifacts[0] = { ...artifacts[0], sha256: 'a'.repeat(64) }
          writeFileSync(stagedReceiptOf(f.root), JSON.stringify({ ...receipt, artifacts }))
        },
        expectError: 'artifact'
      },
      {
        name: 'stale staged candidate',
        mutate: f => rewriteReceipt(f, { stagedAtEpoch: Math.floor(Date.now() / 1000) - 20000000 }),
        expectError: 'stale'
      },
      {
        name: 'receipt path drift',
        mutate: f => rewriteReceipt(f, { stagedPath: '/tmp/somewhere-else.app' }),
        expectError: 'different path'
      }
    ]
    for (const item of cases) {
      const f = makeReleaseFixture()
      item.mutate(f)
      const result = f.runInstaller(['--root', f.root, '--no-relaunch'])
      expect(result.status, `${item.name}: ${result.stderr}`).not.toBe(0)
      expect(result.stderr).toContain(item.expectError)
      // Nothing was mutated.
      expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
      expect(readFileSync(join(f.stagedDir, 'Contents/marker'), 'utf8')).toBe('staged-candidate')
      const installReceipt = join(f.root, 'build/PipiUI Electron.release-install.json')
      if (item.writesReceipt === false) {
        expect(existsSync(installReceipt), item.name).toBe(false)
      } else {
        expect(readJson(installReceipt).status, item.name).toBe('failed')
      }
      expect(f.calls('osascript')).toBe('')
      expect(f.calls('kill')).toBe('')
    }
  })

  it('rejects symlink components and path substitution before lifecycle', { timeout: 20_000 }, () => {
    if (!darwin) return
    const cases: Array<{ name: string; mutate: (f: ReturnType<typeof makeReleaseFixture>) => void; expectError: RegExp; writesReceipt: boolean }> = [
      {
        name: 'symlinked staged App',
        mutate: f => {
          const elsewhere = join(f.root, 'elsewhere.app')
          renameSync(f.stagedDir, elsewhere)
          symlinkSync(elsewhere, f.stagedDir)
          expect(lstatSync(f.stagedDir).isSymbolicLink()).toBe(true)
        },
        expectError: /symlink|no-follow walk/,
        writesReceipt: false
      },
      {
        name: 'symlinked staged receipt',
        mutate: f => {
          const receipt = stagedReceiptOf(f.root)
          const elsewhere = join(f.root, 'receipt-elsewhere.json')
          renameSync(receipt, elsewhere)
          symlinkSync(elsewhere, receipt)
        },
        expectError: /symlink|no-follow walk/,
        writesReceipt: false
      },
      {
        name: 'symlinked staged container',
        mutate: f => {
          const container = stagedContainerOf(f.root)
          const elsewhere = join(f.root, 'container-elsewhere')
          renameSync(container, elsewhere)
          symlinkSync(elsewhere, container)
        },
        expectError: /symlink|no-follow walk/,
        writesReceipt: false
      },
      {
        name: 'symlinked canonical App',
        mutate: f => {
          const canon = join(f.root, 'build/PipiUI Electron.app')
          const elsewhere = join(f.root, 'canon-elsewhere.app')
          renameSync(canon, elsewhere)
          symlinkSync(elsewhere, canon)
        },
        expectError: /symlink|no-follow walk/,
        writesReceipt: false
      },
      {
        name: 'symlinked Trash',
        mutate: f => {
          const elsewhere = join(f.dir, 'trash-elsewhere')
          renameSync(f.trash, elsewhere)
          symlinkSync(elsewhere, f.trash)
        },
        expectError: /symlink|no-follow walk/,
        writesReceipt: false
      }
    ]
    for (const item of cases) {
      const f = makeReleaseFixture()
      item.mutate(f)
      const result = f.runInstaller(['--root', f.root, '--no-relaunch'])
      expect(result.status, `${item.name}: ${result.stderr}`).not.toBe(0)
      expect(result.stderr, item.name).toMatch(item.expectError)
      expect(f.calls('osascript'), item.name).toBe('')
      expect(f.calls('kill'), item.name).toBe('')
      expect(existsSync(join(f.root, 'build/PipiUI Electron.release-install.json')), item.name).toBe(false)
    }
  })

  it('rejects a symlinked root or build directory without writing into the escaped location', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    const linkRoot = join(f.root, 'link-root')
    symlinkSync(f.root, linkRoot)
    const viaLink = f.runInstaller(['--root', linkRoot, '--no-relaunch'])
    expect(viaLink.status).not.toBe(0)
    expect(viaLink.stderr).toMatch(/symlink|no-follow walk/)
    expect(existsSync(join(f.root, 'build/PipiUI Electron.release-install.json'))).toBe(false)
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')

    const g = makeReleaseFixture()
    const realBuild = join(g.root, 'build')
    const elsewhere = join(g.root, 'elsewhere-build')
    renameSync(realBuild, elsewhere)
    symlinkSync(elsewhere, realBuild)
    const viaBuild = g.runInstaller(['--root', g.root, '--no-relaunch'])
    expect(viaBuild.status).not.toBe(0)
    expect(viaBuild.stderr).toMatch(/symlink|no-follow walk/)
    expect(existsSync(join(elsewhere, 'PipiUI Electron.release-install.json'))).toBe(false)
    expect(readFileSync(join(elsewhere, 'PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
    expect(g.calls('osascript')).toBe('')
  })

  it('rejects an ancestor symlink (/tmp/link/repo) before any log/receipt mutation', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    const logPath = join(f.root, 'build/PipiUI Electron.release-install.log')
    const prior = 'PREEXISTING-LOG-BYTES\n'
    writeFileSync(logPath, prior)
    const linkDir = join('/tmp', `pipiui-link-${basename(f.root)}`)
    symlinkSync(dirname(f.root), linkDir)
    const linkedRoot = join(linkDir, basename(f.root))
    try {
      expect(lstatSync('/tmp').isSymbolicLink() || lstatSync(linkDir).isSymbolicLink()).toBe(true)
      const result = f.runInstaller(['--root', linkedRoot, '--no-relaunch'])
      expect(result.status, result.stderr).not.toBe(0)
      expect(result.stderr).toMatch(/symlink|no-follow walk/)
      expect(readFileSync(logPath, 'utf8')).toBe(prior)
      expect(existsSync(join(f.root, 'build/PipiUI Electron.release-install.json'))).toBe(false)
      expect(f.calls('osascript')).toBe('')
      expect(f.calls('kill')).toBe('')
      expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
    } finally {
      rmSync(linkDir, { force: true })
    }
  })

  it('leaves preexisting install log byte-identical when early path validation fails', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    const logPath = join(f.root, 'build/PipiUI Electron.release-install.log')
    const prior = Buffer.from('KEEP-THIS-LOG-EXACTLY\n')
    writeFileSync(logPath, prior)
    const container = stagedContainerOf(f.root)
    const elsewhere = join(f.root, 'container-elsewhere')
    renameSync(container, elsewhere)
    symlinkSync(elsewhere, container)
    const result = f.runInstaller(['--root', f.root, '--no-relaunch'])
    expect(result.status, result.stderr).not.toBe(0)
    expect(result.stderr).toMatch(/symlink|no-follow walk/)
    expect(readFileSync(logPath)).toEqual(prior)
    expect(existsSync(join(f.root, 'build/PipiUI Electron.release-install.json'))).toBe(false)
    expect(f.calls('osascript')).toBe('')
    expect(f.calls('kill')).toBe('')
  })

  it('ignores production seam overrides unless test mode is explicit', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    f.setState('running')
    const result = f.runInstaller(['--root', f.root, '--no-relaunch'], {
      PIPIUI_INSTALLER_TEST_MODE: '',
      PIPIUI_INSTALL_GRACE_ATTEMPTS: '1',
      PIPIUI_INSTALL_TERM_ATTEMPTS: '1',
      PIPIUI_INSTALL_KILL_ATTEMPTS: '1'
    })
    expect(result.status).not.toBe(0)
    // Fake ps/codesign seams must not apply: a 'running' listing cannot trigger
    // the overwrite gate, and real codesign rejects the unsigned fixture.
    expect(result.stderr).not.toContain('--overwrite-running')
    expect(f.calls('osascript')).toBe('')
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
  })

  it('running App without --overwrite-running changes nothing', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    f.setState('running')
    const result = f.runInstaller(['--root', f.root])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--overwrite-running')
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
    expect(readFileSync(join(f.stagedDir, 'Contents/marker'), 'utf8')).toBe('staged-candidate')
    expect(f.calls('osascript')).toBe('')
    expect(f.calls('kill')).toBe('')
  })

  it('installs a fresh candidate when nothing is running and never launches anything', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    const result = f.runInstaller(['--root', f.root])
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('staged-candidate')
    expect(existsSync(join(f.root, 'build/PipiUI Electron.release-staged/PipiUI Electron.app'))).toBe(false)
    const receipt = readJson(join(f.root, 'build/PipiUI Electron.release-install.json'))
    expect(receipt.status).toBe('installed')
    expect(receipt.version).toBe('1.2.3')
    expect(receipt.canonicalPath).toBe(join(f.root, 'build/PipiUI Electron.app'))
    expect(receipt.rollback.performed).toBe(0)
    expect(receipt.relaunch.performed).toBe(0)
    expect(existsSync(join(f.root, 'build/PipiUI Electron.release-install.log'))).toBe(true)
    expect(f.calls('open')).toBe('')
    expect(f.calls('kill')).toBe('')
    // Registers the canonical App; the only unregister target is the previous
    // App moved to Trash, never a nested helper.
    const lsregisterCalls = f.calls('lsregister')
    expect(lsregisterCalls).toContain('-f')
    const unregisterCalls = lsregisterCalls.split('\n').filter(line => line.includes(' -u '))
    expect(unregisterCalls.length).toBeGreaterThan(0)
    expect(unregisterCalls.every(line => line.includes('previous'))).toBe(true)
    // The old App was moved to the trash seam, not deleted.
    expect(readdirSync(f.trash).some(name => name.startsWith('PipiUI Electron previous'))).toBe(true)
  })

  it('--overwrite-running --no-relaunch quits gracefully, swaps, and never relaunches', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    f.setState('running')
    const result = f.runInstaller(['--root', f.root, '--overwrite-running', '--no-relaunch'])
    expect(result.status, result.stderr).toBe(0)
    expect(f.calls('osascript')).toContain('quit')
    // Graceful only: no TERM/KILL ever reached the canonical pid.
    expect(f.calls('kill')).not.toContain('4242')
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('staged-candidate')
    const receipt = readJson(join(f.root, 'build/PipiUI Electron.release-install.json'))
    expect(receipt.status).toBe('installed')
    expect(receipt.stopMethod).toBe('graceful')
    expect(receipt.relaunch.noRelaunchRequested).toBe(1)
    expect(receipt.relaunch.performed).toBe(0)
    expect(receipt.overwriteRunningAuthorized).toBe(1)
    expect(f.calls('open')).toBe('')
  })

  it('falls back to exact-PID TERM only after the graceful quit window', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    f.setState('running')
    writeFileSync(f.osascriptNoFlipFile, '1') // graceful quit does not stop it
    const result = f.runInstaller(['--root', f.root, '--overwrite-running', '--no-relaunch'])
    expect(result.status, result.stderr).toBe(0)
    expect(f.calls('osascript')).toContain('quit')
    const killCalls = f.calls('kill')
    expect(killCalls).toContain('-TERM 4242')
    expect(killCalls).not.toContain('-KILL 4242')
    const receipt = readJson(join(f.root, 'build/PipiUI Electron.release-install.json'))
    expect(receipt.status).toBe('installed')
    expect(receipt.stopMethod).toBe('term')
  })

  it('re-proves the exact command before signalling and never kills a reused PID', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    // Listing still shows a canonical-looking pid 4242, but the per-pid command
    // query proves the pid was reused by an unrelated process.
    f.setState('reproof-flip')
    writeFileSync(f.osascriptNoFlipFile, '1')
    const result = f.runInstaller(['--root', f.root, '--overwrite-running', '--no-relaunch'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('did not exit')
    expect(f.calls('kill')).not.toContain('4242')
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
    const receipt = readJson(join(f.root, 'build/PipiUI Electron.release-install.json'))
    expect(receipt.status).toBe('failed')
  })

  it('rolls back and retains the failed candidate when the installed App fails verification', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    f.setState('running')
    f.setCodesign('fail-canonical')
    const result = f.runInstaller(['--root', f.root, '--overwrite-running', '--no-relaunch'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('rolled back')
    // Previous App restored.
    expect(readFileSync(join(f.root, 'build/PipiUI Electron.app/Contents/marker'), 'utf8')).toBe('old-canonical')
    // Failed candidate retained as evidence.
    const failed = readdirSync(join(f.root, 'build')).filter(name => name.includes('release-install.failed.'))
    expect(failed).toHaveLength(1)
    expect(readFileSync(join(f.root, 'build', failed[0], 'Contents/marker'), 'utf8')).toBe('staged-candidate')
    const receipt = readJson(join(f.root, 'build/PipiUI Electron.release-install.json'))
    expect(receipt.status).toBe('rolled_back')
    expect(receipt.rollback.performed).toBe(1)
  })

  it('relaunches only when --no-relaunch is absent and the App was running', { timeout: 20_000 }, () => {
    if (!darwin) return
    const f = makeReleaseFixture()
    f.setState('running')
    const result = f.runInstaller(['--root', f.root, '--overwrite-running'])
    expect(result.status, result.stderr).toBe(0)
    const receipt = readJson(join(f.root, 'build/PipiUI Electron.release-install.json'))
    expect(receipt.status).toBe('installed')
    expect(receipt.relaunch.performed).toBe(1)
    expect(receipt.relaunch.pid).toBe('777')
    const openCalls = f.calls('open')
    expect(openCalls).toContain('-n')
    expect(openCalls.split('\n').filter(line => line.trim())).toHaveLength(1)
  })
})
