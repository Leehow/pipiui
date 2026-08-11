import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = new URL('./fetch-pi-runtime.mjs', import.meta.url).pathname

describe('persistent embedded Pi runtime CLI', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function seed(platform: 'darwin' = 'darwin', arch: 'arm64' | 'x64' = 'arm64') {
    if (!root) root = await mkdtemp(join(tmpdir(), 'pipiui-runtimes-test-'))
    const target = join(root, `${platform}-${arch}`)
    const node = join(target, 'node', 'bin', 'node')
    const nodeModules = join(target, 'pi', 'lib', 'node_modules')
    const piCli = join(nodeModules, '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
    const launcher = join(target, 'pi', 'bin', 'pi')
    await Promise.all([
      mkdir(join(node, '..'), { recursive: true }),
      mkdir(join(piCli, '..'), { recursive: true }),
      mkdir(join(launcher, '..'), { recursive: true })
    ])
    await Promise.all([
      writeFile(node, '#!/bin/sh\n'),
      writeFile(piCli, '// cli\n'),
      writeFile(launcher, '#!/bin/sh\n'),
      writeFile(join(nodeModules, '@earendil-works', 'pi-coding-agent', 'package.json'), JSON.stringify({ version: '0.84.0' }))
    ])
    await Promise.all([chmod(node, 0o755), chmod(launcher, 0o755)])
    for (const [name, version] of [['pi-web-access', '0.20.0'], ['pi-mcp-extension', '1.5.0']]) {
      const packageRoot = join(nodeModules, name)
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(join(packageRoot, 'dist', 'index.js'), '// extension\n')
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version, pi: { extensions: ['./dist/index.js'] } }))
    }
    await writeFile(join(target, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      nodeVersion: '22.19.0',
      nodeExecutable: 'node/bin/node',
      piCli: 'pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      piLauncher: 'pi/bin/pi',
      nodeModules: 'pi/lib/node_modules',
      packages: {
        '@earendil-works/pi-coding-agent': '0.84.0',
        'pi-web-access': '0.20.0',
        'pi-mcp-extension': '1.5.0'
      }
    }))
    return target
  }

  function run(args: string[], path = process.env.PATH) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: path, PIPIUI_EMBEDDED_RUNTIMES_ROOT: root }
    })
  }

  it('makes a valid repeated prepare a fast no-op without npm or downloader availability', async () => {
    const target = await seed('darwin', 'arm64')
    const before = (await stat(join(target, 'manifest.json'))).mtimeMs
    const result = run(['--platform', 'darwin', '--arch', 'arm64'], '')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Embedded Pi runtime ready for darwin-arm64')
    expect((await stat(join(target, 'manifest.json'))).mtimeMs).toBe(before)
  })

  it('--check is read-only and never creates or removes another target', async () => {
    const arm = await seed('darwin', 'arm64')
    const beforeEntries = await readdir(root)
    const beforeManifest = await readFile(join(arm, 'manifest.json'), 'utf8')
    const valid = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(valid.status).toBe(0)
    expect(await readdir(root)).toEqual(beforeEntries)
    expect(await readFile(join(arm, 'manifest.json'), 'utf8')).toBe(beforeManifest)

    const missing = run(['--platform', 'darwin', '--arch', 'x64', '--check'], '')
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('Embedded Pi runtime check failed for darwin-x64')
    expect(missing.stderr).toContain('npm --prefix Electron run runtime:prepare -- --platform darwin --arch x64')
    expect(await readdir(root)).toEqual(beforeEntries)
  })

  it('detects a version-stale target while leaving an independent target usable', async () => {
    const arm = await seed('darwin', 'arm64')
    await seed('darwin', 'x64')
    const stale = JSON.parse(await readFile(join(arm, 'manifest.json'), 'utf8'))
    stale.nodeVersion = '22.18.0'
    await writeFile(join(arm, 'manifest.json'), JSON.stringify(stale))

    const armCheck = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(armCheck.status).toBe(1)
    expect(armCheck.stderr).toContain('Node is 22.18.0, expected 22.19.0')
    const x64Check = run(['--platform', 'darwin', '--arch', 'x64', '--check'], '')
    expect(x64Check.status).toBe(0)
  })
})
