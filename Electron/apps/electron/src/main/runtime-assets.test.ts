import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { CUA_DRIVER_HELPER_APP, MANAGED_RUNTIME_PACKAGE_VERSIONS, resolveCuaDriverLaunchPath, resolveRuntimeAssets, UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS } from './runtime-assets.js'

/** The path the built main bundle actually runs from; the dev branch walks up from here. */
const builtMainDir = fileURLToPath(new URL('../../out/main', import.meta.url))
const backendPackage = JSON.parse(await readFile(new URL('../../../../packages/pi-backend/package.json', import.meta.url), 'utf8'))
const preparedPiVersion = backendPackage.dependencies['@earendil-works/pi-coding-agent']

describe('resolveRuntimeAssets', () => {
  let root = ''

  it('keeps the host admission and update catalog on the runtime preparer Pi pin', async () => {
    const backend = JSON.parse(await readFile(new URL('../../../../packages/pi-backend/package.json', import.meta.url), 'utf8'))
    const version = backend.dependencies['@earendil-works/pi-coding-agent']
    expect(MANAGED_RUNTIME_PACKAGE_VERSIONS['@earendil-works/pi-coding-agent']).toBe(version)
    expect(UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS['@earendil-works/pi-coding-agent']).toBe(version)
  })

  it('keeps native integrity dependencies out of the user-facing update catalog', () => {
    expect(Object.keys(UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS)).toEqual([
      '@earendil-works/pi-coding-agent',
      'pi-web-access',
      'pi-mcp-extension',
      'pi-hermes-memory'
    ])
    expect(UPDATE_CENTER_RUNTIME_PACKAGE_VERSIONS).not.toHaveProperty('better-sqlite3')
    expect(MANAGED_RUNTIME_PACKAGE_VERSIONS).toHaveProperty('better-sqlite3', '12.11.1')
  })
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function seedEmbeddedRuntime(embedded: string, platform: NodeJS.Platform = 'darwin', arch = 'arm64'): Promise<void> {
    const node = join(embedded, 'node', 'bin', platform === 'win32' ? 'node.cmd' : 'node')
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
      writeFile(join(nodeModules, '@earendil-works', 'pi-coding-agent', 'package.json'), JSON.stringify({ version: preparedPiVersion })),
      mkdir(join(nodeModules, 'pi-hermes-memory'), { recursive: true }).then(() =>
        writeFile(join(nodeModules, 'pi-hermes-memory', 'package.json'), JSON.stringify({ version: '0.9.8' }))),
      mkdir(join(nodeModules, 'better-sqlite3'), { recursive: true }).then(() =>
        writeFile(join(nodeModules, 'better-sqlite3', 'package.json'), JSON.stringify({ version: '12.11.1' })))
    ])
    for (const [name, version] of [['pi-web-access', '0.28.0'], ['pi-mcp-extension', '1.5.0']]) {
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
      nodeVersion: '24.19.0',
      nodeExecutable: platform === 'win32' ? 'node/bin/node.cmd' : 'node/bin/node',
      piCli: 'pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      piLauncher: platform === 'win32' ? 'pi/bin/pi.cmd' : 'pi/bin/pi',
      nodeModules: 'pi/lib/node_modules',
      packages: {
        '@earendil-works/pi-coding-agent': preparedPiVersion,
        'pi-web-access': '0.28.0',
        'pi-mcp-extension': '1.5.0',
        'pi-hermes-memory': '0.9.8',
        'better-sqlite3': '12.11.1'
      }
    }))
  }

  async function seedPackagedRuntime(platform: NodeJS.Platform = 'darwin', arch = 'arm64'): Promise<{ resourcesPath: string; embedded: string }> {
    root = await mkdtemp(join(tmpdir(), 'pipiui-embedded-assets-'))
    const embedded = join(root, platform === 'win32' ? 'pi' : 'pipiui-embedded')
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
        PIPIUI_PI_PATH: join(resourcesPath, 'pipiui-embedded/pi/bin/pi'),
        PIPIUI_ELECTRON_BINARY: process.execPath
      }
    })
    expect(assets.managedNodeModulesRoot).toBe(join(resourcesPath, 'pipiui-embedded/pi/lib/node_modules'))
    expect(JSON.parse(await readFile(join(assets.managedNodeModulesRoot!, 'pi-hermes-memory/package.json'), 'utf8')).version).toBe('0.9.8')
  })

  it('spawns the Electron host, never the unspawnable Windows .cmd shim', async () => {
    const { resourcesPath } = await seedPackagedRuntime('win32', 'x64')
    const assets = resolveRuntimeAssets({ packaged: true, resourcesPath, dirname: builtMainDir, env: { PATH: 'C:\\Windows' }, platform: 'win32', arch: 'x64' })
    // CreateProcessW rejects batch text in any name it is given, and libuv reports
    // that unmapped Win32 error as `spawn UNKNOWN` — the packaged Windows failure.
    expect(assets.piCommand?.executable).toBe(process.execPath)
    expect(assets.piCommand?.env?.PIPIUI_NODE_PATH).toBe(process.execPath)
    // The shim still ships and stays first on PATH for cmd.exe consumers.
    expect(assets.piCommand?.env?.PATH.split(delimiter)[0]).toBe(join(resourcesPath, 'pi/node/bin'))
    expect(assets.managedNodeModulesRoot).toBe(join(resourcesPath, 'pi/pi/lib/node_modules'))
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
    const assets = resolveRuntimeAssets({ packaged: false, resourcesPath: '/nope', dirname: builtMainDir, env, platform: 'darwin', arch: 'not-prepared' })
    expect(assets.sourceRoot).toBe('/tmp/runtime-source')
    expect(assets.cuaDriver).toBe('/tmp/drv')
  })

  it('refuses nested CuaDriver Helper.app and detaches Darwin hosts out of the App', async () => {
    root = await mkdtemp(join(tmpdir(), 'pipiui-cua-helper-'))
    const configured = join(root, 'cua-driver')
    const helper = join(root, CUA_DRIVER_HELPER_APP, 'Contents', 'MacOS', 'cua-driver')
    const userData = join(root, 'udata')
    await mkdir(dirname(helper), { recursive: true })
    await writeFile(configured, 'raw-driver')
    await writeFile(helper, 'helper-driver')
    expect(resolveCuaDriverLaunchPath(configured, 'darwin')).toBe(configured)
    expect(resolveCuaDriverLaunchPath(helper, 'darwin')).toBe(configured)
    expect(resolveCuaDriverLaunchPath(configured, 'linux')).toBe(configured)
    const { resourcesPath } = await seedPackagedRuntime()
    await mkdir(join(resourcesPath, 'cua-driver'), { recursive: true })
    await writeFile(join(resourcesPath, 'cua-driver', 'cua-driver'), 'pkg-driver')
    const assets = resolveRuntimeAssets({
      packaged: true,
      resourcesPath,
      dirname: builtMainDir,
      env: { PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      arch: 'arm64',
      userData
    })
    expect(assets.cuaDriver).toBe(join(userData, 'detached-hosts', 'cua-driver'))
    expect(assets.piCommand?.executable).toBe(join(userData, 'detached-hosts', 'node'))
    expect(await readFile(assets.cuaDriver, 'utf8')).toBe('pkg-driver')
  })

  it('launches nested Pi through the packaged node shim, not raw Helper execPath', async () => {
    const source = await readFile(new URL('../../../../resources/runtime/pi-ext/subagent/index.ts', import.meta.url), 'utf8')
    const start = source.indexOf('function getPiInvocation')
    const end = source.indexOf('\nfunction ', start + 1)
    const block = source.slice(start, end === -1 ? undefined : end)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(block).toContain('process.env.PIPIUI_NODE_PATH')
    expect(block).toMatch(/command:\s*nodeShim/)
  })
})
