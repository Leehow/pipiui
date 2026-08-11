import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRuntimeAssets } from './runtime-assets.js'

/** The path the built main bundle actually runs from; the dev branch walks up from here. */
const builtMainDir = fileURLToPath(new URL('../../out/main', import.meta.url))

describe('resolveRuntimeAssets', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function seedEmbeddedRuntime(embedded: string, platform: NodeJS.Platform = 'darwin', arch = 'arm64'): Promise<void> {
    const node = join(embedded, 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
    const piCli = join(embedded, 'pi', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
    const launcher = join(embedded, 'pi', 'bin', platform === 'win32' ? 'pi.cmd' : 'pi')
    const nodeModules = join(embedded, 'pi', 'lib', 'node_modules')
    await Promise.all([
      mkdir(join(node, '..'), { recursive: true }),
      mkdir(join(piCli, '..'), { recursive: true }),
      mkdir(join(launcher, '..'), { recursive: true })
    ])
    await Promise.all([
      writeFile(node, ''),
      writeFile(piCli, '// pi cli\n'),
      writeFile(launcher, ''),
      writeFile(join(nodeModules, '@earendil-works', 'pi-coding-agent', 'package.json'), JSON.stringify({ version: '0.84.0' }))
    ])
    for (const [name, version] of [['pi-web-access', '0.20.0'], ['pi-mcp-extension', '1.5.0']]) {
      const packageRoot = join(nodeModules, name)
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(join(packageRoot, 'dist', 'index.js'), '// extension\n')
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version, pi: { extensions: ['./dist/index.js'] } }))
    }
    if (platform !== 'win32') await chmod(node, 0o755)
    await writeFile(join(embedded, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      nodeVersion: '22.19.0',
      nodeExecutable: platform === 'win32' ? 'node/bin/node.exe' : 'node/bin/node',
      piCli: 'pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      piLauncher: platform === 'win32' ? 'pi/bin/pi.cmd' : 'pi/bin/pi',
      nodeModules: 'pi/lib/node_modules',
      packages: {
        '@earendil-works/pi-coding-agent': '0.84.0',
        'pi-web-access': '0.20.0',
        'pi-mcp-extension': '1.5.0'
      }
    }))
  }

  async function seedPackagedRuntime(platform: NodeJS.Platform = 'darwin', arch = 'arm64'): Promise<{ resourcesPath: string; embedded: string }> {
    root = await mkdtemp(join(tmpdir(), 'pipiui-embedded-assets-'))
    const embedded = join(root, 'pipiui-embedded')
    await mkdir(join(root, 'pipiui-runtime'), { recursive: true })
    await seedEmbeddedRuntime(embedded, platform, arch)
    return { resourcesPath: root, embedded }
  }

  it('retains external-Pi fallback when the project target runtime has not been prepared', () => {
    const assets = resolveRuntimeAssets({ packaged: false, resourcesPath: '/electron/dist/Resources', dirname: builtMainDir, env: {}, platform: 'darwin', arch: 'not-prepared' })
    expect(assets.sourceRoot?.endsWith('Electron/resources/runtime')).toBe(true)
    expect(assets.piCommand).toBeUndefined()
    expect(assets.managedNodeModulesRoot?.endsWith('Electron/node_modules')).toBe(true)
  })

  it('uses an explicitly selected persistent project runtime during development', async () => {
    const { embedded } = await seedPackagedRuntime()
    const assets = resolveRuntimeAssets({
      packaged: false,
      resourcesPath: '/electron/dist/Resources',
      dirname: builtMainDir,
      env: { PATH: '/usr/bin:/bin', PIPIUI_EMBEDDED_RUNTIME_DIR: embedded },
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(assets.piCommand?.executable).toBe(join(embedded, 'node/bin/node'))
    expect(assets.piCommand?.prefixArgs).toEqual([join(embedded, 'pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js')])
    expect(assets.managedNodeModulesRoot).toBe(join(embedded, 'pi/lib/node_modules'))
  })

  it('resolves the current target from the project persistent runtime directory by default', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipiui-project-runtime-'))
    const fakeMainDir = join(root, 'apps', 'electron', 'out', 'main')
    const embedded = join(root, '.embedded-runtimes', 'darwin-arm64')
    await seedEmbeddedRuntime(embedded)
    const assets = resolveRuntimeAssets({
      packaged: false,
      resourcesPath: '/electron/dist/Resources',
      dirname: fakeMainDir,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(assets.piCommand?.executable).toBe(join(embedded, 'node/bin/node'))
    expect(assets.managedNodeModulesRoot).toBe(join(embedded, 'pi/lib/node_modules'))
  })

  it('fails closed for an explicit but missing development runtime override', () => {
    expect(() => resolveRuntimeAssets({
      packaged: false,
      resourcesPath: '/electron/dist/Resources',
      dirname: builtMainDir,
      env: { PIPIUI_EMBEDDED_RUNTIME_DIR: '/does/not/exist' },
      platform: 'darwin',
      arch: 'arm64'
    })).toThrow('manifest is missing or unreadable')
  })

  it('uses bundled Node and the real unpacked Pi CLI for a packaged launch', async () => {
    const { resourcesPath } = await seedPackagedRuntime()
    const assets = resolveRuntimeAssets({ packaged: true, resourcesPath, dirname: builtMainDir, env: { PATH: '/usr/bin:/bin' }, platform: 'darwin', arch: 'arm64' })
    expect(assets.sourceRoot).toBe(join(resourcesPath, 'pipiui-runtime'))
    expect(assets.piCommand).toEqual({
      executable: join(resourcesPath, 'pipiui-embedded/node/bin/node'),
      prefixArgs: [join(resourcesPath, 'pipiui-embedded/pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js')],
      piPath: join(resourcesPath, 'pipiui-embedded/pi/bin/pi'),
      env: {
        PATH: `${join(resourcesPath, 'pipiui-embedded/node/bin')}:${join(resourcesPath, 'pipiui-embedded/pi/bin')}:/usr/bin:/bin`,
        PIPIUI_NODE_PATH: join(resourcesPath, 'pipiui-embedded/node/bin/node'),
        PIPIUI_PI_PATH: join(resourcesPath, 'pipiui-embedded/pi/bin/pi')
      }
    })
    expect(assets.managedNodeModulesRoot).toBe(join(resourcesPath, 'pipiui-embedded/pi/lib/node_modules'))
  })

  it('fails closed when a packaged runtime is absent or for another architecture', async () => {
    expect(() => resolveRuntimeAssets({ packaged: true, resourcesPath: '/nope', dirname: builtMainDir, env: {}, platform: 'darwin', arch: 'arm64' }))
      .toThrow('missing PipiUI runtime source')
    const { resourcesPath } = await seedPackagedRuntime('darwin', 'x64')
    expect(() => resolveRuntimeAssets({ packaged: true, resourcesPath, dirname: builtMainDir, env: {}, platform: 'darwin', arch: 'arm64' }))
      .toThrow('target mismatch')
  })

  it('lets the environment override the one runtime source root without an existence check', () => {
    const env = { PIPIUI_RUNTIME_SOURCE_ROOT: '/tmp/runtime-source', PIPIUI_CUA_DRIVER_PATH: '/tmp/drv' }
    const assets = resolveRuntimeAssets({ packaged: false, resourcesPath: '/nope', dirname: builtMainDir, env })
    expect(assets.sourceRoot).toBe('/tmp/runtime-source')
    expect(assets.cuaDriver).toBe('/tmp/drv')
  })

  it('ships a provider-visible image block in every screenshot tool result', async () => {
    const source = await readFile(new URL('../../../../resources/runtime/extensions/pipiui-computer-use.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/type:\s*"image" as const,\s*data:\s*base64,\s*mimeType:/)
    expect(source).toContain('PIPIUI_COMPUTER_SCREENSHOT')
  })
})
