import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultRuntimesRoot = join(electronRoot, '.embedded-runtimes')
const metadata = JSON.parse(await readFile(join(electronRoot, 'node-runtime-assets.json'), 'utf8'))
const backendPackage = JSON.parse(await readFile(join(electronRoot, 'packages', 'pi-backend', 'package.json'), 'utf8'))
const brokerPackage = JSON.parse(await readFile(join(electronRoot, 'resources', 'runtime', 'pi-ext', 'packages', 'memory-broker', 'package.json'), 'utf8'))
const brokerLock = JSON.parse(await readFile(join(electronRoot, 'resources', 'runtime', 'pi-ext', 'packages', 'memory-broker', 'package-lock.json'), 'utf8'))
const electronPackage = JSON.parse(await readFile(join(electronRoot, 'apps', 'electron', 'package.json'), 'utf8'))
const hermesPackageName = 'pi-hermes-memory'
const hermesPackageVersion = brokerPackage.dependencies?.[hermesPackageName]
const betterSqliteVersion = brokerLock.packages?.['node_modules/better-sqlite3']?.version
const electronVersion = electronPackage.devDependencies?.electron
const runtimePackageNames = [
  '@earendil-works/pi-coding-agent',
  'pi-web-access',
  'pi-mcp-extension'
]
const requiredPackages = {
  ...Object.fromEntries(runtimePackageNames.map(name => [name, backendPackage.dependencies?.[name]])),
  [hermesPackageName]: hermesPackageVersion,
  // Hermes declares a range, but the Electron runtime needs a reviewed native
  // artifact and npm 12 requires install-script approval. Reuse the broker's
  // committed lock resolution so both the ABI approval and package are exact.
  'better-sqlite3': betterSqliteVersion
}

function usage() {
  console.log(`Prepare or validate PipiUI's persistent embedded Pi runtime.

Usage:
  node scripts/fetch-pi-runtime.mjs [--platform <darwin|win32|linux>] [--arch <x64|arm64>]
                                    [--check | --force]

Modes:
  prepare (default)  Reuse a complete target runtime; otherwise download/install it once.
  --check            Read-only validation. Fails with the exact prepare command when stale/missing.
  --force            Rebuild the selected target even when it is already current.

Discoverable npm commands:
  npm run runtime:prepare       # current host target
  npm run runtime:check         # current host target, read-only
  npm run runtime:update        # current host target, forced refresh
  npm run runtime:prepare:mac   # darwin x64 + arm64
  npm run runtime:check:mac     # darwin x64 + arm64, read-only

Advanced/test override:
  PIPIUI_EMBEDDED_RUNTIMES_ROOT=/absolute/path
`)
}

function parseArgs(argv) {
  const result = { check: false, force: false, help: false, platform: undefined, arch: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--check') result.check = true
    else if (value === '--force') result.force = true
    else if (value === '--help' || value === '-h') result.help = true
    else if (value === '--platform' || value === '--arch') {
      const next = argv[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`)
      result[value.slice(2)] = next
      index += 1
    } else throw new Error(`Unknown argument: ${value}`)
  }
  if (result.check && result.force) throw new Error('--check and --force are mutually exclusive')
  return result
}

function exactVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
}

function confinedPath(root, relativePath, label) {
  if (!relativePath || isAbsolute(relativePath)) throw new Error(`${label} has an invalid path`)
  const candidate = resolve(root, relativePath)
  const rel = relative(resolve(root), candidate)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${label} escapes its runtime root`)
  return candidate
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function isFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function isDirectory(path) {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

async function packageVersion(nodeModules, name) {
  try { return (await json(join(nodeModules, ...name.split('/'), 'package.json'))).version } catch { return undefined }
}

async function declaredEntrypoint(nodeModules, name) {
  try {
    const packageRoot = join(nodeModules, ...name.split('/'))
    const manifest = await json(join(packageRoot, 'package.json'))
    const entry = manifest?.pi?.extensions?.[0]
    if (typeof entry !== 'string') return undefined
    const path = confinedPath(packageRoot, entry, `${name} entrypoint`)
    return (await isFile(path)) || (await isDirectory(path)) ? path : undefined
  } catch { return undefined }
}

function nativeArchitectures(bytes, platform) {
  if (platform === 'darwin' && bytes.length >= 8) {
    const cpuName = value => value === 0x01000007 ? 'x64' : value === 0x0100000c ? 'arm64' : undefined
    if (bytes.readUInt32LE(0) === 0xfeedfacf) return [cpuName(bytes.readUInt32LE(4))].filter(Boolean)
    const magic = bytes.readUInt32BE(0)
    if ((magic === 0xcafebabe || magic === 0xcafebabf) && bytes.length >= 8) {
      const count = bytes.readUInt32BE(4)
      const stride = magic === 0xcafebabf ? 32 : 20
      const values = []
      for (let index = 0; index < count; index += 1) {
        const offset = 8 + index * stride
        if (offset + 4 > bytes.length) break
        const name = cpuName(bytes.readUInt32BE(offset))
        if (name) values.push(name)
      }
      return values
    }
  }
  if (platform === 'linux' && bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const little = bytes[5] === 1
    const machine = little ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
    return machine === 62 ? ['x64'] : machine === 183 ? ['arm64'] : []
  }
  if (platform === 'win32' && bytes.length >= 64 && bytes.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = bytes.readUInt32LE(0x3c)
    if (peOffset + 6 <= bytes.length && bytes.subarray(peOffset, peOffset + 4).toString('binary') === 'PE\0\0') {
      const machine = bytes.readUInt16LE(peOffset + 4)
      return machine === 0x8664 ? ['x64'] : machine === 0xaa64 ? ['arm64'] : []
    }
  }
  return []
}

async function inspectHermesNative(nodeModules, { platform, arch }) {
  const addon = join(nodeModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  let bytes
  try { bytes = await readFile(addon) } catch { return { ok: false, reason: `better-sqlite3 native addon is missing: ${addon}` } }
  const architectures = nativeArchitectures(bytes, platform)
  if (!architectures.includes(arch)) {
    return {
      ok: false,
      reason: `better-sqlite3 native addon is ${architectures.join('+') || 'an unrecognized binary'}, expected ${arch}`
    }
  }
  return { ok: true, addon, architectures }
}

// `npm install` leaves development-only payload in the tree we ship inside the
// app bundle. None of it is reachable at runtime: pi loads `.ts` extensions
// through jiti (transpile-only, so no `.d.ts` is consulted), sourcemaps only
// serve debuggers, and koffi ships prebuilt binaries for eighteen platforms
// while a build targets exactly one. pi-coding-agent's own `docs/` IS read at
// runtime via getDocsPath(), so Markdown under any `docs/` directory stays.
// Anchored on a code extension so a package shipping a genuine `.map` data file
// keeps it; `.d.ts.map` is covered by the `.ts.map` alternative.
const PRUNABLE_FILE = /(?:\.(?:js|mjs|cjs|css|ts|mts|cts)\.map|\.d\.(?:ts|mts|cts)|\.md)$/

// `koffi/build/koffi` holds nothing but one directory per prebuilt target, so
// every sibling of the slice we ship goes. glibc and musl are separate builds
// and a Linux package has to run on both.
function koffiPrebuildsToKeep(platform, arch) {
  return platform === 'linux' ? [`linux_${arch}`, `musl_${arch}`] : [`${platform}_${arch}`]
}

async function pruneRuntimeTree(root, { platform, arch }) {
  const keptPrebuilds = new Set(koffiPrebuildsToKeep(platform, arch))
  let removed = 0
  // koffi lays its prebuilt binaries out as `koffi/build/koffi/<platform>_<arch>`.
  const walk = async (dir, insideDocs, holdsPrebuilds) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (holdsPrebuilds && !keptPrebuilds.has(entry.name)) {
          await rm(path, { recursive: true, force: true })
          removed += 1
          continue
        }
        await walk(path, insideDocs || entry.name === 'docs', entry.name === 'koffi' && basename(dir) === 'build')
        continue
      }
      if (!entry.isFile()) continue
      if (insideDocs && entry.name.endsWith('.md')) continue
      if (!PRUNABLE_FILE.test(entry.name)) continue
      await rm(path, { force: true })
      removed += 1
    }
  }
  await walk(root, false, false)
  return removed
}

// Electron already contains a Node runtime, so shipping a second standalone Node
// cost ~85MB for nothing once Electron 43 (Node 24) cleared pi's `>=22.19.0`
// floor. This shim keeps the path everyone already resolves — PATH via
// runtime-assets, `pi/bin/pi`'s hardcoded `../../node/bin/node`, and npm's
// `#!/usr/bin/env node` shebang — while execing Electron in Node mode.
//
// The app exports PIPIUI_ELECTRON_BINARY because it alone knows the correct Node
// host. On macOS that is Electron's background Helper rather than the foreground
// app executable, which would create one Dock tile per long-lived Pi process.
// The relative fallbacks only cover invocations the app did not launch.
const NODE_SHIM_POSIX = `#!/bin/sh
# Generated by scripts/fetch-pi-runtime.mjs — PipiUI ships no standalone Node.
if [ -n "\${PIPIUI_ELECTRON_BINARY:-}" ] && [ -x "\${PIPIUI_ELECTRON_BINARY}" ]; then
  exec env ELECTRON_RUN_AS_NODE=1 "\${PIPIUI_ELECTRON_BINARY}" "$@"
fi
self_dir=$(cd "$(dirname "$0")" && pwd -P)
# Packaged: <app>/Contents/Resources/pipiui-embedded/node/bin -> <app>/Contents/MacOS
# Development: <root>/.embedded-runtimes/<target>/node/bin -> <root>/node_modules
for candidate in \\
  "$self_dir"/../../../../Frameworks/*" Helper.app"/Contents/MacOS/*" Helper" \\
  "$self_dir"/../../../../MacOS/* \\
  "$self_dir"/../../../../node_modules/electron/dist/Electron.app/Contents/Frameworks/"Electron Helper.app"/Contents/MacOS/"Electron Helper" \\
  "$self_dir"/../../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
do
  if [ -f "$candidate" ] && [ -x "$candidate" ]; then
    exec env ELECTRON_RUN_AS_NODE=1 "$candidate" "$@"
  fi
done
echo "pipiui: no Electron binary provides Node; set PIPIUI_ELECTRON_BINARY" >&2
exit 127
`

const NODE_SHIM_WINDOWS = `@echo off
rem Generated by scripts/fetch-pi-runtime.mjs — PipiUI ships no standalone Node.
if defined PIPIUI_ELECTRON_BINARY (
  set ELECTRON_RUN_AS_NODE=1
  "%PIPIUI_ELECTRON_BINARY%" %*
  exit /b %errorlevel%
)
echo pipiui: no Electron binary provides Node; set PIPIUI_ELECTRON_BINARY 1>&2
exit /b 127
`

async function writeNodeShim(nodePath, platform) {
  await writeFile(nodePath, platform === 'win32' ? NODE_SHIM_WINDOWS : NODE_SHIM_POSIX)
  if (platform !== 'win32') await chmod(nodePath, 0o755)
}

// The official Node tarball ships an unstripped binary (~106MB on darwin-arm64);
// dropping its debug symbols saves ~21MB. `strip` invalidates the Mach-O
// signature and macOS SIGKILLs an arm64 binary carrying a broken one, so re-sign
// ad-hoc right here: development runs this exact tree, and only packaging
// re-signs with the release identity. Stripping is an optimization, never a
// correctness requirement, so any failure restores the original binary.
async function stripEmbeddedNode(nodePath, platform, arch) {
  if (platform !== 'darwin' || process.platform !== 'darwin') return 0
  const before = (await stat(nodePath)).size
  const backup = `${nodePath}.unstripped`
  await copyFile(nodePath, backup)
  try {
    run('strip', ['-S', '-x', nodePath], { stdio: 'ignore' })
    run('codesign', ['--sign', '-', '--force', nodePath], { stdio: 'ignore' })
    run('codesign', ['--verify', nodePath], { stdio: 'ignore' })
    // A cross-architecture binary cannot be trusted to run here, so only the
    // matching-arch build gets the definitive check.
    if (arch === process.arch) run(nodePath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    const saved = before - (await stat(nodePath)).size
    await rm(backup, { force: true })
    return saved
  } catch (error) {
    await rename(backup, nodePath)
    console.warn(`Embedded Node strip skipped, shipping the unstripped binary: ${error.message}`)
    return 0
  }
}

async function inspectRuntime(root, expected) {
  let manifest
  try { manifest = await json(join(root, 'manifest.json')) } catch { return { ok: false, reason: 'manifest.json is missing or unreadable' } }
  if (manifest.schemaVersion !== 1) return { ok: false, reason: `manifest schema is ${manifest.schemaVersion ?? 'missing'}, expected 1` }
  if (manifest.platform !== expected.platform || manifest.arch !== expected.arch)
    return { ok: false, reason: `target is ${manifest.platform ?? 'missing'}-${manifest.arch ?? 'missing'}, expected ${expected.platform}-${expected.arch}` }
  if (manifest.nodeVersion !== metadata.version)
    return { ok: false, reason: `Node is ${manifest.nodeVersion ?? 'missing'}, expected ${metadata.version}` }
  for (const [name, version] of Object.entries(requiredPackages)) {
    if (manifest.packages?.[name] !== version)
      return { ok: false, reason: `${name} manifest version is ${manifest.packages?.[name] ?? 'missing'}, expected ${version}` }
  }

  let node
  let piCli
  let piLauncher
  let nodeModules
  try {
    node = confinedPath(root, manifest.nodeExecutable, 'Node executable')
    piCli = confinedPath(root, manifest.piCli, 'Pi CLI')
    piLauncher = confinedPath(root, manifest.piLauncher, 'Pi launcher')
    nodeModules = confinedPath(root, manifest.nodeModules, 'node_modules')
  } catch (error) { return { ok: false, reason: error.message } }
  if (!(await isFile(node))) return { ok: false, reason: `Node executable is missing: ${node}` }
  if (!(await isFile(piCli))) return { ok: false, reason: `Pi CLI is missing: ${piCli}` }
  if (!(await isFile(piLauncher))) return { ok: false, reason: `Pi launcher is missing: ${piLauncher}` }
  if (!(await isDirectory(nodeModules))) return { ok: false, reason: `node_modules is missing: ${nodeModules}` }
  if (expected.platform !== 'win32') {
    try { await access(node, constants.X_OK) } catch { return { ok: false, reason: `Node executable is not executable: ${node}` } }
  }
  for (const [name, version] of Object.entries(requiredPackages)) {
    const actual = await packageVersion(nodeModules, name)
    if (actual !== version) return { ok: false, reason: `${name} installed version is ${actual ?? 'missing'}, expected ${version}` }
  }
  for (const name of ['pi-web-access', 'pi-mcp-extension']) {
    if (!(await declaredEntrypoint(nodeModules, name))) return { ok: false, reason: `${name} declared Pi extension entrypoint is missing` }
  }
  const hermesNative = await inspectHermesNative(nodeModules, expected)
  if (!hermesNative.ok) return hermesNative
  // A runtime prepared before pruning existed would silently add ~245MB to the
  // app bundle; the CLI sourcemap is the cheapest witness that it was skipped.
  if (await isFile(`${piCli}.map`)) return { ok: false, reason: 'runtime still carries development-only sourcemaps (prepared before pruning)' }
  // A runtime prepared before the shim existed still carries an 85MB standalone
  // Node. Sourcemaps are not a witness for it — that tree is pruned but fat — so
  // check the executable is the shim rather than a Mach-O.
  try {
    const head = (await readFile(node)).subarray(0, 16).toString('utf8')
    if (!head.startsWith('#!') && !head.startsWith('@echo')) {
      return { ok: false, reason: 'embedded Node is a standalone binary, not the Electron shim (prepared before the shim existed)' }
    }
  } catch (error) { return { ok: false, reason: `Node executable is unreadable: ${error.message}` } }
  return { ok: true, manifest, node, piCli, piLauncher, nodeModules }
}

function prepareCommand(platform, arch) {
  return `npm --prefix Electron run runtime:prepare -- --platform ${platform} --arch ${arch}`
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`)
}

function npmInvocation() {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) return { command: process.execPath, prefixArgs: [npmExecPath], shell: false }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixArgs: [], shell: process.platform === 'win32' }
}

async function bytesWithPinnedChecksum(cacheRoot, asset) {
  await mkdir(cacheRoot, { recursive: true })
  const archive = join(cacheRoot, asset.archive)
  let bytes
  try { bytes = await readFile(archive) } catch { bytes = undefined }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    const response = await fetch(`${metadata.baseUrl}/${asset.archive}`)
    if (!response.ok) throw new Error(`Node runtime download failed: ${response.status} ${response.statusText}`)
    bytes = Buffer.from(await response.arrayBuffer())
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== asset.sha256) throw new Error(`Node runtime checksum mismatch: expected ${asset.sha256}, got ${actual}`)
    await writeFile(archive, bytes)
  }
  return archive
}

async function extractNode(archive, asset, destination) {
  if (asset.archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const quotedArchive = archive.replaceAll("'", "''")
      const quotedDestination = destination.replaceAll("'", "''")
      run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${quotedArchive}' -DestinationPath '${quotedDestination}' -Force`])
    } else run('unzip', ['-q', archive, '-d', destination])
  } else run('tar', ['-xzf', archive, '-C', destination])
}

async function replaceRuntime(staging, destination, runtimesRoot, key) {
  const backup = join(runtimesRoot, `.previous-${key}-${process.pid}-${Date.now()}`)
  let previous = false
  try {
    try { await rename(destination, backup); previous = true } catch (error) { if (error?.code !== 'ENOENT') throw error }
    try { await rename(staging, destination) } catch (error) {
      if (previous) await rename(backup, destination)
      throw error
    }
    if (previous) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (previous && !(await isDirectory(destination)) && (await isDirectory(backup))) await rename(backup, destination)
    throw error
  }
}

async function buildRuntime({ asset, destination, key, platform, arch, runtimesRoot }) {
  await mkdir(runtimesRoot, { recursive: true })
  const extraction = await mkdtemp(join(tmpdir(), `pipiui-node-runtime-${key}-`))
  const staging = await mkdtemp(join(runtimesRoot, `.staging-${key}-`))
  try {
    const archive = await bytesWithPinnedChecksum(join(electronRoot, '.node-runtime-cache'), asset)
    await extractNode(archive, asset, extraction)
    const extractedNode = join(extraction, ...asset.nodePath.split('/'))
    if (!(await isFile(extractedNode))) throw new Error(`${asset.archive} did not contain ${asset.nodePath}`)

    const nodeRelative = platform === 'win32' ? join('node', 'node.exe') : join('node', 'bin', 'node')
    const stagedNode = join(staging, nodeRelative)
    await mkdir(dirname(stagedNode), { recursive: true })
    await writeNodeShim(stagedNode, platform)
    console.log(`Wrote the Electron-backed Node shim (saves ~85MB over a standalone Node ${metadata.version})`)

    const archiveRoot = asset.nodePath.split('/')[0]
    try { await copyFile(join(extraction, archiveRoot, 'LICENSE'), join(staging, 'node', 'LICENSE')) } catch { /* executable is required */ }

    const piLib = join(staging, 'pi', 'lib')
    await mkdir(piLib, { recursive: true })
    await writeFile(join(piLib, 'package.json'), `${JSON.stringify({
      name: 'pipiui-embedded-pi-runtime',
      private: true,
      version: '1.0.0',
      dependencies: requiredPackages,
      allowScripts: {
        [`better-sqlite3@${betterSqliteVersion}`]: true
      }
    }, null, 2)}\n`)
    const npm = npmInvocation()
    run(npm.command, [
      ...npm.prefixArgs,
      'install',
      '--omit=dev',
      '--include=optional',
      '--no-audit',
      '--no-fund',
      // This install runs with --prefix pointing at a staging directory, so the
      // repository .npmrc that carries these limits may not be on npm's config
      // path. Passing them explicitly keeps the proxy deadlock (see Electron/.npmrc)
      // from stranding a release build.
      '--maxsockets', '3',
      '--fetch-timeout', '60000',
      `--os=${platform}`,
      `--cpu=${arch}`,
      '--prefix',
      piLib
    ], {
      shell: npm.shell,
      env: {
        ...process.env,
        // pi-hermes-memory's better-sqlite3 addon is loaded by Electron in
        // ELECTRON_RUN_AS_NODE mode. Select the Electron ABI as well as the
        // destination architecture; npm's --cpu/--os alone do not reach every
        // native install script during a cross-architecture release build.
        npm_config_runtime: 'electron',
        npm_config_target: electronVersion,
        npm_config_disturl: 'https://electronjs.org/headers',
        npm_config_arch: arch,
        npm_config_platform: platform
      }
    })

    const nodeModules = join(piLib, 'node_modules')
    const piCli = join(nodeModules, '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
    if (!(await isFile(piCli))) throw new Error('Installed Pi package has no dist/cli.js')

    // Prune before the manifest is written so the staged validation below runs
    // against exactly the tree that ships.
    const pruned = await pruneRuntimeTree(piLib, { platform, arch })
    console.log(`Pruned ${pruned} development-only path(s) from the embedded Pi runtime`)

    const piBin = join(staging, 'pi', 'bin')
    await mkdir(piBin, { recursive: true })
    const launcherRelative = platform === 'win32' ? join('pi', 'bin', 'pi.cmd') : join('pi', 'bin', 'pi')
    const launcher = join(staging, launcherRelative)
    if (platform === 'win32') {
      await writeFile(launcher, '@echo off\r\n"%~dp0..\\..\\node\\node.exe" "%~dp0..\\lib\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js" %*\r\n')
    } else {
      await writeFile(launcher, '#!/bin/sh\nexec "$(dirname "$0")/../../node/bin/node" "$(dirname "$0")/../lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$@"\n')
      await chmod(launcher, 0o755)
    }

    const portable = path => relative(staging, path).split('\\').join('/')
    await writeFile(join(staging, 'manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      nodeVersion: metadata.version,
      nodeExecutable: portable(stagedNode),
      piCli: portable(piCli),
      piLauncher: portable(launcher),
      nodeModules: portable(nodeModules),
      packages: requiredPackages
    }, null, 2)}\n`)

    const staged = await inspectRuntime(staging, { platform, arch })
    if (!staged.ok) throw new Error(`Staged runtime validation failed: ${staged.reason}`)
    await replaceRuntime(staging, destination, runtimesRoot, key)
  } finally {
    await rm(extraction, { recursive: true, force: true })
    await rm(staging, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); return }
  const platform = options.platform || process.env.PIPIUI_RUNTIME_PLATFORM || process.platform
  const arch = options.arch || process.env.PIPIUI_RUNTIME_ARCH || process.arch
  const key = `${platform}-${arch}`
  const asset = metadata.assets[key]
  if (!asset) throw new Error(`No pinned Node runtime asset for ${key}`)
  for (const [name, version] of Object.entries(requiredPackages)) {
    if (!exactVersion(version)) throw new Error(`${name} must be an exact production dependency, got ${version ?? 'missing'}`)
  }
  if (!exactVersion(electronVersion)) throw new Error(`Electron must be an exact development dependency, got ${electronVersion ?? 'missing'}`)

  const runtimesRoot = resolve(process.env.PIPIUI_EMBEDDED_RUNTIMES_ROOT || defaultRuntimesRoot)
  const destination = join(runtimesRoot, key)
  const started = performance.now()
  let current = await inspectRuntime(destination, { platform, arch })
  if (current.ok && !options.force) {
    console.log(`Embedded Pi runtime ready for ${key} (${Math.round(performance.now() - started)}ms): ${destination}`)
    return
  }
  if (options.check) {
    throw new Error(`Embedded Pi runtime check failed for ${key}: ${current.reason}.\nPrepare it with: ${prepareCommand(platform, arch)}`)
  }

  const legacy = join(electronRoot, '.embedded-runtime')
  if (!options.force && runtimesRoot === defaultRuntimesRoot && !(await isDirectory(destination))) {
    const legacyState = await inspectRuntime(legacy, { platform, arch })
    if (legacyState.ok) {
      await mkdir(runtimesRoot, { recursive: true })
      await rename(legacy, destination)
      current = await inspectRuntime(destination, { platform, arch })
      if (!current.ok) throw new Error(`Migrated runtime failed validation: ${current.reason}`)
      console.log(`Migrated embedded Pi runtime to persistent target ${key}: ${destination}`)
      return
    }
  }

  console.log(`${options.force ? 'Refreshing' : 'Preparing'} embedded Pi runtime for ${key}...`)
  await buildRuntime({ asset, destination, key, platform, arch, runtimesRoot })
  console.log(`Prepared embedded Pi ${requiredPackages['@earendil-works/pi-coding-agent']} with Node ${metadata.version} for ${key}: ${destination}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
