import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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
  await copyFile(source, new URL(executable, destination))
  if (targetPlatform !== 'win32') await chmod(new URL(executable, destination), 0o755)
  console.log(new URL(executable, destination).pathname)

  // Packaging pulls from a per-target directory instead: the macOS asset is a
  // universal binary, but each electron-builder run ships exactly one slice.
  const packagedArches = targetPlatform === 'darwin' ? ['x64', 'arm64'] : [targetArch]
  for (const arch of packagedArches) {
    const targetDir = new URL(`${targetPlatform}-${arch}/`, destination)
    await mkdir(targetDir, { recursive: true })
    const packaged = new URL(executable, targetDir)
    // lipo names slices the Mach-O way, not the Node way.
    const slice = arch === 'x64' ? 'x86_64' : arch
    const thinned = targetPlatform === 'darwin'
      ? spawnSync('lipo', [source, '-thin', slice, '-output', fileURLToPath(packaged)], { encoding: 'utf8' })
      : undefined
    // lipo fails on a binary that is already single-slice, and is absent off macOS.
    if (!thinned || thinned.status !== 0) await copyFile(source, packaged)
    if (targetPlatform !== 'win32') await chmod(packaged, 0o755)
    console.log(packaged.pathname)
  }
} finally { await rm(staging, { recursive: true, force: true }) }
