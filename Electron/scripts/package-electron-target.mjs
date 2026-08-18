import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  console.log(`Validate one persistent embedded runtime and package only that target.

Usage:
  node scripts/package-electron-target.mjs --platform <darwin|win32|linux> --arch <x64|arm64> -- <electron-builder args>

This command never prepares, downloads, or installs the runtime. If validation fails, run the
runtime:prepare command printed by the checker before starting the release build.
`)
}

function parseArgs(argv) {
  const separator = argv.indexOf('--')
  const own = separator >= 0 ? argv.slice(0, separator) : argv
  const builderArgs = separator >= 0 ? argv.slice(separator + 1) : []
  const result = { platform: undefined, arch: undefined, builderArgs, help: false }
  for (let index = 0; index < own.length; index += 1) {
    const value = own[index]
    if (value === '--help' || value === '-h') result.help = true
    else if (value === '--platform' || value === '--arch') {
      const next = own[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`)
      result[value.slice(2)] = next
      index += 1
    } else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`)
}

/** Unsigned Windows/Linux CI and local dev must not die on forceCodeSigning. */
export function unsignedBuilderArgs(platform, env = process.env) {
  if (platform === 'darwin') return []
  if (env.CSC_LINK || env.WIN_CSC_LINK || env.CSC_KEY_PASSWORD) return []
  return ['-c.forceCodeSigning=false']
}

/** VS 2022 without Spectre CRT libs fails node-pty rebuild (MSB8040). */
export function windowsNativeRebuildEnv(platform, root = electronRoot, env = process.env) {
  if (platform !== 'win32') return {}
  return {
    ForceImportBeforeCppTargets: env.ForceImportBeforeCppTargets || join(root, 'Directory.Build.props')
  }
}

const defaultVcvars64 = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat'
const defaultVswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'

export function resolveVcvars64(env = process.env) {
  if (env.PIPIUI_VCVARS64 && existsSync(env.PIPIUI_VCVARS64)) return env.PIPIUI_VCVARS64
  if (existsSync(defaultVcvars64)) return defaultVcvars64
  if (!existsSync(defaultVswhere)) return undefined
  const found = spawnSync(defaultVswhere, ['-latest', '-products', '*', '-find', 'VC\\Auxiliary\\Build\\vcvars64.bat'], { encoding: 'utf8' })
  const path = (found.stdout || '').trim().split(/\r?\n/).find(Boolean)
  return path && existsSync(path) ? path : undefined
}

/** Import vcvars64 so electron-rebuild/link can see delayimp.lib and the MSVC LIB path. */
export function windowsMsvcEnv(platform, env = process.env) {
  if (platform !== 'win32' || process.platform !== 'win32') return {}
  const vcvars = resolveVcvars64(env)
  if (!vcvars) return {}
  const result = spawnSync(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `call "${vcvars}" >nul && set`], { encoding: 'utf8', windowsHide: true })
  const imported = {}
  for (const line of (result.stdout || '').split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    imported[key] = line.slice(index + 1)
  }
  return imported
}

export function findDelayimpLibDir(env = process.env) {
  const vcvars = resolveVcvars64(env)
  const msvcRoot = vcvars ? resolve(dirname(vcvars), '..', '..', 'Tools', 'MSVC') : undefined
  const roots = [env.PIPIUI_MSVC_LIB_DIR, msvcRoot].filter(Boolean)
  for (const root of roots) {
    if (existsSync(join(root, 'delayimp.lib'))) return root
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const libDir = join(root, entry.name, 'lib', 'x64')
      if (existsSync(join(libDir, 'delayimp.lib'))) return libDir
    }
  }
  return undefined
}

export function writeWindowsPtyBuildProps(root, libDir) {
  if (!libDir) return []
  const props = `<?xml version="1.0" encoding="utf-8"?>
<Project>
  <PropertyGroup>
    <SpectreMitigation>false</SpectreMitigation>
    <LibraryPath>${libDir};$(LibraryPath)</LibraryPath>
  </PropertyGroup>
</Project>
`
  const dirs = [
    join(root, 'node_modules', 'node-pty'),
    join(root, 'node_modules', 'node-pty', 'build'),
    join(root, 'node_modules', 'node-pty', 'build', 'deps', 'winpty', 'src')
  ]
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Directory.Build.props'), props)
  }
  return dirs
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); return }
  if (!options.platform || !options.arch || options.builderArgs.length === 0) {
    usage()
    throw new Error('--platform, --arch, and electron-builder arguments after -- are required')
  }
  const key = `${options.platform}-${options.arch}`
  const releaseEnv = {
    ...process.env,
    PIPIUI_EMBEDDED_RUNTIMES_ROOT: join(electronRoot, '.embedded-runtimes')
  }
  run(process.execPath, [
    join(electronRoot, 'scripts', 'fetch-pi-runtime.mjs'),
    '--platform', options.platform,
    '--arch', options.arch,
    '--check'
  ], { env: releaseEnv })
  console.log(`Packaging with persistent embedded runtime ${key}`)
  Object.assign(releaseEnv, windowsMsvcEnv(options.platform, releaseEnv))
  if (options.platform === 'win32') {
    const libDir = findDelayimpLibDir(releaseEnv)
    const written = writeWindowsPtyBuildProps(electronRoot, libDir)
    if (libDir) {
      releaseEnv.LIB = `${libDir}${releaseEnv.LIB ? `;${releaseEnv.LIB}` : ''}`
      console.log(`Windows native rebuild LIB+=${libDir} props=${written.length}`)
    }
  }
  run(process.execPath, [
    join(electronRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    ...options.builderArgs,
    ...unsignedBuilderArgs(options.platform, releaseEnv)
  ], {
    cwd: join(electronRoot, 'apps', 'electron'),
    env: {
      ...releaseEnv,
      ...windowsNativeRebuildEnv(options.platform, electronRoot, releaseEnv),
      PIPIUI_EMBEDDED_RUNTIME_TARGET: key
    }
  })
  if (options.platform === 'linux') {
    // electron-builder output is repo-root build/ (apps/electron package.json
    // build.directories.output = ../../../build). Do not fall back to other trees:
    // an older compatible pty.node elsewhere would hide a too-new packaged binary.
    run(process.execPath, [
      join(electronRoot, 'scripts', 'check-linux-pty-glibc.mjs'),
      '--search',
      join(electronRoot, '..', 'build')
    ])
  }
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try { return fileURLToPath(import.meta.url) === resolve(entry) } catch { return false }
}

if (invokedAsCli()) {
  try { main() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
