import { createHash } from 'node:crypto'
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

export const CUA_DRIVER_HELPER_APP = 'CuaDriver Helper.app'
export const CUA_DRIVER_HELPER_INFO_PLIST = readFileSync(new URL('./cua-driver-helper-Info.plist', import.meta.url), 'utf8')

async function placeBinary(source, destination) {
  if (resolve(source) === resolve(destination)) return
  await rm(destination, { force: true })
  try { await link(source, destination) } catch { await copyFile(source, destination) }
}

export async function writeDarwinCuaDriverHelperApp(parentDir, binarySource) {
  const appDir = join(parentDir, CUA_DRIVER_HELPER_APP)
  const destination = join(appDir, 'Contents', 'MacOS', 'cua-driver')
  await mkdir(join(destination, '..'), { recursive: true })
  await placeBinary(binarySource, destination)
  await chmod(destination, 0o755)
  await writeFile(join(appDir, 'Contents', 'Info.plist'), CUA_DRIVER_HELPER_INFO_PLIST, { mode: 0o644 })
  return destination
}

/** One thinned (or copied) raw Mach-O. Do not wrap it in Helper.app — that re-triggers Gatekeeper. */
export async function materializePackagedDarwinCuaDriverSlice(targetDir, source, slice) {
  await mkdir(targetDir, { recursive: true })
  const packaged = join(targetDir, 'cua-driver')
  await rm(join(targetDir, CUA_DRIVER_HELPER_APP), { recursive: true, force: true })
  const thinned = slice
    ? spawnSync('lipo', [source, '-thin', slice, '-output', packaged], { encoding: 'utf8' })
    : undefined
  if (!thinned || thinned.status !== 0) await placeBinary(source, packaged)
  await chmod(packaged, 0o755)
  return packaged
}

function invokedAsCli() {
  const entry = process.argv[1]
  if (!entry) return false
  try { return fileURLToPath(import.meta.url) === resolve(entry) } catch { return false }
}

export async function fetchCuaDriver() {
  const manifest = JSON.parse(await readFile(new URL('../cua-driver-assets.json', import.meta.url), 'utf8'))
  const targetPlatform = process.env.CUA_TARGET_PLATFORM || process.platform
  const targetArch = process.env.CUA_TARGET_ARCH || process.arch
  const key = targetPlatform === 'darwin' ? 'darwin-universal' : `${targetPlatform}-${targetArch}`
  const asset = manifest.assets[key]
  if (!asset) throw new Error(`No pinned Cua Driver asset for ${key}`)
  const cache = new URL('../.cua-driver-cache/', import.meta.url)
  await mkdir(cache, { recursive: true })
  const archive = new URL(asset.archive, cache)
  let bytes
  try { bytes = await readFile(archive) } catch { bytes = undefined }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    const response = await fetch(`https://github.com/trycua/cua/releases/download/${manifest.tag}/${asset.archive}`)
    if (!response.ok) throw new Error(`Cua Driver download failed: ${response.status} ${response.statusText}`)
    bytes = Buffer.from(await response.arrayBuffer())
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== asset.sha256) throw new Error(`Cua Driver checksum mismatch: expected ${asset.sha256}, got ${actual}`)
    await writeFile(archive, bytes)
  }
  const staging = await mkdtemp(join(tmpdir(), 'pipiui-electron-cua-'))
  try {
    const extract = asset.archive.endsWith('.zip')
      ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.pathname.replaceAll("'", "''")}' -DestinationPath '${staging.replaceAll("'", "''")}' -Force`], { stdio: 'inherit' })
      : spawnSync('tar', ['-xzf', archive.pathname, '-C', staging], { stdio: 'inherit' })
    if (extract.status !== 0) throw new Error(`failed to extract ${basename(asset.archive)}`)
    const executable = targetPlatform === 'win32' ? 'cua-driver.exe' : 'cua-driver'
    const find = spawnSync(targetPlatform === 'win32' ? 'where.exe' : 'find', targetPlatform === 'win32' ? ['/r', staging, executable] : [staging, '-type', 'f', '-name', executable], { encoding: 'utf8' })
    const source = find.stdout.split(/\r?\n/).find(Boolean)
    if (!source) throw new Error(`${basename(asset.archive)} did not contain ${executable}`)
    const destination = new URL('../.cua-driver/', import.meta.url)
    await mkdir(destination, { recursive: true })
    // Dev resolves this fixed path (runtime-assets.ts, dev-electron-app.sh), so the
    // as-downloaded binary stays put.
    const destinationDir = fileURLToPath(destination)
    const raw = join(destinationDir, executable)
    await copyFile(source, raw)
    if (targetPlatform !== 'win32') await chmod(raw, 0o755)
    console.log(raw)

    // Packaging pulls from a per-target directory instead: the macOS asset is a
    // universal binary, but each electron-builder run ships exactly one slice.
    const packagedArches = targetPlatform === 'darwin' ? ['x64', 'arm64'] : [targetArch]
    for (const arch of packagedArches) {
      const targetDir = join(destinationDir, `${targetPlatform}-${arch}`)
      await mkdir(targetDir, { recursive: true })
      if (targetPlatform === 'darwin') {
        // lipo names slices the Mach-O way, not the Node way.
        const slice = arch === 'x64' ? 'x86_64' : arch
        const packaged = await materializePackagedDarwinCuaDriverSlice(targetDir, source, slice)
        console.log(packaged)
        continue
      }
      const packaged = join(targetDir, executable)
      await copyFile(source, packaged)
      if (targetPlatform !== 'win32') await chmod(packaged, 0o755)
      console.log(packaged)
    }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

if (invokedAsCli()) await fetchCuaDriver()
