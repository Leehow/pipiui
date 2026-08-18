import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CUA_DRIVER_HELPER_APP,
  CUA_DRIVER_HELPER_INFO_PLIST,
  extractArchive,
  findNamedFile,
  materializePackagedDarwinCuaDriverSlice,
  writeDarwinCuaDriverHelperApp
} from './fetch-cua-driver.mjs'
import { resolveCuaDriverLaunchPath } from '../apps/electron/src/main/runtime-assets.ts'

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

/** Stored (method 0) zip so Windows CI can exercise extractArchive without a zip CLI. */
function storedZip(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const localFull = Buffer.concat([local, nameBuf, data])
    locals.push(localFull)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, nameBuf]))
    offset += localFull.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, eocd])
}

describe('Darwin Cua driver helper layout', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  it('writes a deterministic LSUIElement helper and one packaged binary', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipiui-cua-layout-'))
    const source = join(root, 'src-bin')
    await writeFile(source, 'driver-bytes')
    await chmod(source, 0o755)
    const slice = join(root, 'darwin-arm64')
    await mkdir(slice, { recursive: true })
    await writeFile(join(slice, 'cua-driver'), 'stale-raw-sibling')
    const launch = await materializePackagedDarwinCuaDriverSlice(slice, source)
    const packaged = join(slice, 'cua-driver')
    expect(launch).toBe(packaged)
    expect(await readFile(packaged, 'utf8')).toBe('driver-bytes')
    expect(existsSync(join(slice, CUA_DRIVER_HELPER_APP))).toBe(false)
    expect(resolveCuaDriverLaunchPath(packaged, 'darwin')).toBe(packaged)
  })

  it('hardlinks the top-level raw binary into the dev helper without removing it', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipiui-cua-dev-helper-'))
    const raw = join(root, 'cua-driver')
    await writeFile(raw, 'universal-bytes')
    await chmod(raw, 0o755)
    const helper = await writeDarwinCuaDriverHelperApp(root, raw)
    expect(existsSync(raw)).toBe(true)
    expect(await readFile(helper, 'utf8')).toBe('universal-bytes')
    expect((await stat(raw)).ino).toBe((await stat(helper)).ino)
    expect(resolveCuaDriverLaunchPath(raw, 'darwin')).toBe(raw)
  })

  it('extracts zip archives without powershell and finds the Windows exe', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipiui-cua-zip-'))
    const zip = join(root, 'cua.zip')
    await writeFile(zip, storedZip({ 'bin/cua-driver.exe': Buffer.from('win-driver') }))
    const staging = join(root, 'out')
    await mkdir(staging)
    extractArchive(zip, staging, 'cua.zip')
    expect(await findNamedFile(staging, 'cua-driver.exe')).toMatch(/cua-driver\.exe$/)
  })
})
