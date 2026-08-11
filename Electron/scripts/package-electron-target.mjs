import { spawnSync } from 'node:child_process'
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
  run(process.execPath, [
    join(electronRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    ...options.builderArgs
  ], {
    cwd: join(electronRoot, 'apps', 'electron'),
    env: { ...releaseEnv, PIPIUI_EMBEDDED_RUNTIME_TARGET: key }
  })
}

try { main() } catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
