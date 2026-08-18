import { lstat, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

export const EMBEDDED_RUNTIME_MAX_BYTES = 320 * 1024 * 1024
export const WINDOWS_INSTALLER_MAX_BYTES = 700 * 1024 * 1024
export const WINDOWS_INSTALLER_MIN_BYTES = 1024 * 1024

/**
 * Keep npm's temporary prefix outside the Electron workspace it is installing
 * from. npm otherwise discovers Electron/package.json as the workspace root and
 * installs `pipiui-electron-workspace` into the runtime. Because that workspace
 * contains `.embedded-runtimes`, the target then recursively contains itself.
 * Repo-root build/ is on the same volume as the destination, so the final rename
 * remains atomic on Windows runners.
 */
export function runtimeStagingPrefix(electronRoot, key) {
  return join(dirname(resolve(electronRoot)), 'build', `.embedded-runtime-staging-${key}-`)
}

export async function inspectEmbeddedRuntimeTree(root, maxBytes = EMBEDDED_RUNTIME_MAX_BYTES) {
  const resolvedRoot = resolve(root)
  const stack = [resolvedRoot]
  let bytes = 0
  let files = 0

  while (stack.length > 0) {
    const directory = stack.pop()
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      return { ok: false, reason: `runtime tree is unreadable at ${directory}: ${error.message}`, bytes, files }
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const rel = relative(resolvedRoot, path).split('\\').join('/')
      if (entry.isDirectory()) {
        if (entry.name === '.embedded-runtimes') {
          return { ok: false, reason: `runtime recursively embeds .embedded-runtimes at ${rel}`, bytes, files }
        }
        if (rel === 'pi/lib/node_modules/pipiui-electron-workspace') {
          return { ok: false, reason: `runtime contains the Electron source workspace at ${rel}`, bytes, files }
        }
        stack.push(path)
        continue
      }
      const info = await lstat(path)
      bytes += info.size
      files += 1
      if (bytes > maxBytes) {
        return { ok: false, reason: `runtime is ${bytes} bytes, over the ${maxBytes}-byte budget`, bytes, files }
      }
    }
  }
  return { ok: true, bytes, files }
}

export async function assertEmbeddedRuntimeTree(root, maxBytes = EMBEDDED_RUNTIME_MAX_BYTES) {
  const result = await inspectEmbeddedRuntimeTree(root, maxBytes)
  if (!result.ok) throw new Error(`Embedded runtime package contract failed: ${result.reason}`)
  return result
}

export async function assertFreshWindowsInstallerBudget(outputDirectory, startedAtMs, {
  minBytes = WINDOWS_INSTALLER_MIN_BYTES,
  maxBytes = WINDOWS_INSTALLER_MAX_BYTES
} = {}) {
  const entries = await readdir(outputDirectory, { withFileTypes: true })
  const installers = []
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.exe') continue
    const path = join(outputDirectory, entry.name)
    const info = await stat(path)
    if (info.mtimeMs + 1_000 < startedAtMs) continue
    installers.push({ path, name: basename(path), bytes: info.size })
  }
  if (installers.length === 0) throw new Error(`Windows installer missing from ${outputDirectory}`)
  for (const installer of installers) {
    if (installer.bytes < minBytes) throw new Error(`Windows installer ${installer.name} is a stub (${installer.bytes} bytes)`)
    if (installer.bytes > maxBytes) throw new Error(`Windows installer ${installer.name} is ${installer.bytes} bytes, over the ${maxBytes}-byte budget`)
  }
  return installers
}
