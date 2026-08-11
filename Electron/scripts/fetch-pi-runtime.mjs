import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultRuntimesRoot = join(electronRoot, '.embedded-runtimes')
const metadata = JSON.parse(await readFile(join(electronRoot, 'node-runtime-assets.json'), 'utf8'))
const backendPackage = JSON.parse(await readFile(join(electronRoot, 'packages', 'pi-backend', 'package.json'), 'utf8'))
const runtimePackageNames = [
  '@earendil-works/pi-coding-agent',
  'pi-web-access',
  'pi-mcp-extension'
]
const requiredPackages = Object.fromEntries(runtimePackageNames.map(name => [name, backendPackage.dependencies?.[name]]))

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
    await copyFile(extractedNode, stagedNode)
    if (platform !== 'win32') await chmod(stagedNode, 0o755)

    const archiveRoot = asset.nodePath.split('/')[0]
    try { await copyFile(join(extraction, archiveRoot, 'LICENSE'), join(staging, 'node', 'LICENSE')) } catch { /* executable is required */ }

    const piLib = join(staging, 'pi', 'lib')
    await mkdir(piLib, { recursive: true })
    await writeFile(join(piLib, 'package.json'), `${JSON.stringify({
      name: 'pipiui-embedded-pi-runtime',
      private: true,
      version: '1.0.0',
      dependencies: requiredPackages
    }, null, 2)}\n`)
    const npm = npmInvocation()
    run(npm.command, [
      ...npm.prefixArgs,
      'install',
      '--omit=dev',
      '--include=optional',
      '--no-audit',
      '--no-fund',
      `--os=${platform}`,
      `--cpu=${arch}`,
      '--prefix',
      piLib
    ], { shell: npm.shell })

    const nodeModules = join(piLib, 'node_modules')
    const piCli = join(nodeModules, '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
    if (!(await isFile(piCli))) throw new Error('Installed Pi package has no dist/cli.js')

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
