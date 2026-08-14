import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { PiCommand, RuntimeAssets } from '@pipi/pi-backend'

export interface AssetLookup {
  /** `app.isPackaged`. Decides whether the shipped copies or the repository are authoritative. */
  packaged: boolean
  /** `process.resourcesPath`. Under an unpackaged Electron this points into node_modules, not at us. */
  resourcesPath: string
  /** `__dirname` of the built main bundle (`apps/electron/out/main`). */
  dirname: string
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
}

export interface ResolvedAssets extends RuntimeAssets {
  cuaDriver: string
  /** Undefined only when development has no prepared project runtime and falls back to external Pi. */
  piCommand?: PiCommand
  /** Real, unpacked production dependencies mounted with Pi's `-e` option. */
  managedNodeModulesRoot?: string
}

const fileIfPresent = (path: string): string | undefined => (existsSync(path) ? path : undefined)
const EXPECTED_NODE_VERSION = '22.19.0'
const EXPECTED_PACKAGES = {
  '@earendil-works/pi-coding-agent': '0.84.0',
  'pi-web-access': '0.20.0',
  'pi-mcp-extension': '1.5.0',
  'pi-hermes-memory': '0.9.4',
  'better-sqlite3': '12.11.1'
} as const

type EmbeddedRuntimeManifest = {
  schemaVersion: 1
  platform: NodeJS.Platform
  arch: string
  nodeVersion: string
  nodeExecutable: string
  piCli: string
  piLauncher: string
  nodeModules: string
  packages: Record<string, string>
}

function confinedPath(root: string, relativePath: string, label: string): string {
  if (!relativePath || isAbsolute(relativePath)) throw new Error(`Embedded Pi ${label} has an invalid path`)
  const path = resolve(root, relativePath)
  const rel = relative(resolve(root), path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Embedded Pi ${label} escapes its runtime root`)
  return path
}

function requireFile(root: string, relativePath: string, label: string): string {
  const path = confinedPath(root, relativePath, label)
  try {
    if (!statSync(path).isFile()) throw new Error('not a file')
  } catch {
    throw new Error(`Packaged PipiUI is missing embedded Pi ${label}: ${path}`)
  }
  return path
}

function requireDirectory(path: string, label: string): string {
  try {
    if (!statSync(path).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new Error(`Packaged PipiUI is missing ${label}: ${path}`)
  }
  return path
}

function packageVersion(nodeModulesRoot: string, name: string): string | undefined {
  try { return JSON.parse(readFileSync(join(nodeModulesRoot, name, 'package.json'), 'utf8')).version } catch { return undefined }
}

function electronNodeHost(platform: NodeJS.Platform, execPath = process.execPath): string {
  if (platform !== 'darwin') return execPath
  const name = basename(execPath)
  return join(dirname(execPath), '..', 'Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`)
}

function resolveEmbeddedPi(
  root: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  arch: string
): Pick<ResolvedAssets, 'piCommand' | 'managedNodeModulesRoot'> {
  let manifest: EmbeddedRuntimeManifest
  try { manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as EmbeddedRuntimeManifest } catch {
    throw new Error(`PipiUI embedded Pi manifest is missing or unreadable: ${join(root, 'manifest.json')}`)
  }
  if (manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.arch !== arch)
    throw new Error(`Embedded Pi target mismatch: expected ${platform}-${arch}, got ${manifest.platform}-${manifest.arch}`)
  if (manifest.nodeVersion !== EXPECTED_NODE_VERSION)
    throw new Error(`Embedded Pi Node mismatch: expected ${EXPECTED_NODE_VERSION}, got ${manifest.nodeVersion}`)
  for (const [name, version] of Object.entries(EXPECTED_PACKAGES)) {
    if (manifest.packages?.[name] !== version)
      throw new Error(`Embedded Pi manifest mismatch for ${name}: expected ${version}, got ${manifest.packages?.[name] ?? 'missing'}`)
  }

  const node = requireFile(root, manifest.nodeExecutable, 'Node executable')
  const piCli = requireFile(root, manifest.piCli, 'CLI')
  const piLauncher = requireFile(root, manifest.piLauncher, 'launcher')
  const nodeModules = requireDirectory(confinedPath(root, manifest.nodeModules, 'node_modules'), 'embedded Pi node_modules')
  if (platform !== 'win32') {
    try { accessSync(node, constants.X_OK) } catch { throw new Error(`Embedded Pi Node executable is not executable: ${node}`) }
  }
  for (const [name, version] of Object.entries(EXPECTED_PACKAGES)) {
    const actual = packageVersion(nodeModules, name)
    if (actual !== version) throw new Error(`Embedded Pi package mismatch for ${name}: expected ${version}, got ${actual ?? 'missing'}`)
  }
  const commandEnv = {
    PATH: [dirname(node), dirname(piLauncher), env.PATH].filter(Boolean).join(delimiter),
    PIPIUI_NODE_PATH: node,
    PIPIUI_PI_PATH: piLauncher,
    // On macOS the main Electron executable is a foreground application even
    // under ELECTRON_RUN_AS_NODE, so every long-lived Pi process gets another
    // Dock tile. Electron's LSUIElement helper carries the same Node runtime
    // without registering as a foreground app.
    PIPIUI_ELECTRON_BINARY: electronNodeHost(platform)
  }
  return {
    piCommand: { executable: node, prefixArgs: [piCli], piPath: piLauncher, env: commandEnv },
    managedNodeModulesRoot: nodeModules
  }
}

/**
 * Where the shipped pi assets live for this launch.
 *
 * Packaged builds read the one `pipiui-runtime` extraResource. A dev run resolves the same
 * Electron-owned tree from this workspace; it never falls back to another app's source tree.
 */
export function resolveRuntimeAssets(lookup: AssetLookup): ResolvedAssets {
  const { env } = lookup
  const platform = lookup.platform ?? process.platform
  const arch = lookup.arch ?? process.arch
  const driverName = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
  if (lookup.packaged) {
    const root = lookup.resourcesPath
    const sourceRoot = env.PIPIUI_RUNTIME_SOURCE_ROOT ?? requireDirectory(join(root, 'pipiui-runtime'), 'PipiUI runtime source')
    return {
      sourceRoot,
      cuaDriver: env.PIPIUI_CUA_DRIVER_PATH ?? join(root, 'cua-driver', driverName),
      ...resolveEmbeddedPi(join(root, 'pipiui-embedded'), env, platform, arch)
    }
  }
  // apps/electron/out/main -> out -> electron -> apps -> Electron.
  const electronRoot = resolve(lookup.dirname, '..', '..', '..', '..')
  const embeddedRoot = env.PIPIUI_EMBEDDED_RUNTIME_DIR
    ? resolve(env.PIPIUI_EMBEDDED_RUNTIME_DIR)
    : join(electronRoot, '.embedded-runtimes', `${platform}-${arch}`)
  const shouldUseEmbedded = Boolean(env.PIPIUI_EMBEDDED_RUNTIME_DIR) || existsSync(embeddedRoot)
  const embedded = shouldUseEmbedded ? resolveEmbeddedPi(embeddedRoot, env, platform, arch) : {}
  return {
    sourceRoot: env.PIPIUI_RUNTIME_SOURCE_ROOT ?? fileIfPresent(join(electronRoot, 'resources', 'runtime')),
    cuaDriver: env.PIPIUI_CUA_DRIVER_PATH ?? join(electronRoot, '.cua-driver', driverName),
    managedNodeModulesRoot: fileIfPresent(join(electronRoot, 'node_modules')),
    ...embedded
  }
}
