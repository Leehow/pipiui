import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CUA_DRIVER_HELPER_APP,
  CUA_DRIVER_HELPER_INFO_PLIST,
  materializePackagedDarwinCuaDriverSlice,
  writeDarwinCuaDriverHelperApp
} from './fetch-cua-driver.mjs'
import { resolveCuaDriverLaunchPath } from '../apps/electron/src/main/runtime-assets.ts'

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
})
