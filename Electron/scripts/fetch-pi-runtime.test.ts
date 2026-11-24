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
    const hermes = join(nodeModules, 'pi-hermes-memory', 'package.json')
    const sqliteNative = join(nodeModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
    const launcher = join(target, 'pi', 'bin', 'pi')
    await Promise.all([
      mkdir(join(node, '..'), { recursive: true }),
      mkdir(join(piCli, '..'), { recursive: true }),
      mkdir(join(hermes, '..'), { recursive: true }),
      mkdir(join(sqliteNative, '..'), { recursive: true }),
      mkdir(join(launcher, '..'), { recursive: true })
    ])
    await Promise.all([
      writeFile(node, (() => {
        // Darwin now requires a standalone Mach-O Node (not the Electron shim).
        const header = Buffer.alloc(32)
        header.writeUInt32LE(0xfeedfacf, 0)
        header.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
        return header
      })()),
      writeFile(piCli, '// cli\n'),
      writeFile(hermes, JSON.stringify({ name: 'pi-hermes-memory', version: '0.11.0' })),
      writeFile(join(nodeModules, 'better-sqlite3', 'package.json'), JSON.stringify({ name: 'better-sqlite3', version: '13.2.0' })),
      // Thin Mach-O header with the requested CPU type. inspectRuntime only
      // needs the header to reject a closure prepared for the other target.
      writeFile(sqliteNative, (() => {
        const header = Buffer.alloc(32)
        header.writeUInt32LE(0xfeedfacf, 0)
        header.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
        return header
      })()),
      writeFile(launcher, '#!/bin/sh\n'),
      writeFile(join(nodeModules, '@earendil-works', 'pi-coding-agent', 'package.json'), JSON.stringify({ version: '1.6.0' }))
    ])
    await Promise.all([chmod(node, 0o755), chmod(launcher, 0o755)])
    for (const [name, version] of [['pi-web-access', '0.48.0'], ['pi-mcp-extension', '1.16.2']]) {
      const packageRoot = join(nodeModules, name)
      await mkdir(join(packageRoot, 'dist'), { recursive: true })
      await writeFile(join(packageRoot, 'dist', 'index.js'), '// extension\n')
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version, pi: { extensions: ['./dist/index.js'] } }))
    }
    await writeFile(join(target, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      nodeVersion: '24.19.0',
      nodeExecutable: 'node/bin/node',
      piCli: 'pi/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      piLauncher: 'pi/bin/pi',
      nodeModules: 'pi/lib/node_modules',
      packages: {
        '@earendil-works/pi-coding-agent': '1.6.0',
        'pi-web-access': '0.48.0',
        'pi-mcp-extension': '1.16.2',
        'pi-hermes-memory': '0.11.0',
        'better-sqlite3': '13.2.0'
      }
    }))
    return target
  }

  function run(args: string[], path = process.env.PATH) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: path, PIPIUI_EMBEDDED_RUNTIMES_ROOT: root, PIPIUI_SKIP_OFFICECLI: '1' }
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

  it('rejects a cached runtime carrying unused legacy SDK peers without deleting its files', async () => {
    const target = await seed()
    const oldSdk = join(target, 'pi/lib/node_modules/@mariozechner/pi-coding-agent')
    const clipboard = join(target, 'pi/lib/node_modules/@mariozechner/clipboard')
    await Promise.all([mkdir(oldSdk, { recursive: true }), mkdir(clipboard, { recursive: true })])
    await writeFile(join(oldSdk, 'package.json'), JSON.stringify({ version: '0.73.1' }))
    await writeFile(join(clipboard, 'package.json'), JSON.stringify({ version: '0.3.9' }))
    const result = run(['--check'], '')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unused legacy Pi SDK @mariozechner/pi-coding-agent')
    expect(JSON.parse(await readFile(join(oldSdk, 'package.json'), 'utf8')).version).toBe('0.73.1')
    expect(JSON.parse(await readFile(join(clipboard, 'package.json'), 'utf8')).version).toBe('0.3.9')
  })

  it('requires refreshing a cache that still carries the Domino test corpus', async () => {
    const target = await seed()
    const fixtures = join(target, 'pi/lib/node_modules/fixture-package/node_modules/@mixmark-io/domino/test')
    await mkdir(fixtures, { recursive: true })
    await writeFile(join(fixtures, 'fixture.html'), '<p>test data</p>')
    const result = run(['--check'], '')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unused Domino HTML test corpus')
    expect(await readFile(join(fixtures, 'fixture.html'), 'utf8')).toBe('<p>test data</p>')
  })

  it('rejects foreign esbuild prebuilds at nested peer locations without touching the target binary', async () => {
    const target = await seed()
    const scope = join(target, 'pi/lib/node_modules/peer/node_modules/@esbuild')
    await Promise.all(['linux-x64', 'darwin-arm64'].map(name => mkdir(join(scope, name, 'bin'), { recursive: true })))
    await writeFile(join(scope, 'linux-x64/bin/esbuild'), 'foreign binary')
    await writeFile(join(scope, 'darwin-arm64/bin/esbuild'), 'target binary')
    const result = run(['--check'], '')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('esbuild prebuilt for linux-x64, expected darwin-arm64')
    expect(await readFile(join(scope, 'darwin-arm64/bin/esbuild'), 'utf8')).toBe('target binary')
  })

  it('never execs Helper.app from the Node shim (Gatekeeper re-scan)', async () => {
    const source = await readFile(new URL('./fetch-pi-runtime.mjs', import.meta.url), 'utf8')
    expect(source).toContain('Never exec * Helper.app here')
    expect(source).toContain('case "\\${PIPIUI_ELECTRON_BINARY}" in')
    expect(source).toContain('*" Helper.app"*|*/Contents/Frameworks/*" Helper") ;;')
    expect(source).not.toMatch(/Frameworks\/\*" Helper\.app"\/Contents\/MacOS/)
    expect(source).toContain('"$self_dir"/../../../../MacOS/*')
    expect(source).toContain('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  })

  it('never names the Windows Node shim .exe (CreateProcessW rejects batch text)', async () => {
    const source = await readFile(new URL('./fetch-pi-runtime.mjs', import.meta.url), 'utf8')
    // A `.exe` holding `@echo off` cannot be started by CreateProcessW, and libuv
    // reports that unmapped Win32 error as `spawn UNKNOWN` — every packaged
    // Windows build failed that way for pi, the auth helper and every worker.
    expect(source).toContain("join('node', 'node.cmd')")
    expect(source).not.toContain("join('node', 'node.exe')")
    // pi.cmd must `call` the shim, or control never returns to it.
    expect(source).toContain('call "%~dp0..\\\\..\\\\node\\\\node.cmd"')
    // %errorlevel% inside a parenthesized block expands at parse time, not run time.
    expect(source).toContain('if not defined PIPIUI_ELECTRON_BINARY goto :no_electron')
    expect(source).toContain("!node.endsWith('.cmd')")
  })

  it('caps npm concurrency on the staged install, which --prefix puts outside the repo .npmrc', async () => {
    const source = await readFile(new URL('./fetch-pi-runtime.mjs', import.meta.url), 'utf8')
    // npm's default of 15 sockets deadlocks behind a local HTTP proxy and strands
    // the release build with no output at all; the repo .npmrc cannot reach an
    // install that runs under --prefix.
    expect(source).toContain("'--maxsockets', '3'")
    expect(source).toContain("'--fetch-timeout', '60000'")
    expect(source).toContain("'--no-workspaces'")
    expect(source).toContain('cwd: piLib')
    expect(source).toContain("npm_config_workspaces: 'false'")
    expect(source).toContain('[`better-sqlite3@${betterSqliteVersion}`]: true')
    const npmrc = await readFile(new URL('../.npmrc', import.meta.url), 'utf8')
    expect(npmrc).toMatch(/^maxsockets=3$/m)
  })

  it('rejects a darwin target whose Node is still the Electron shim', async () => {
    const arm = await seed('darwin', 'arm64')
    const node = join(arm, 'node', 'bin', 'node')
    expect(run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '').status).toBe(0)

    await writeFile(node, '#!/bin/sh\nexec false\n')
    await chmod(node, 0o755)
    const shim = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(shim.status).toBe(1)
    expect(shim.stderr).toContain('Electron shim')
  })

  it('rejects a target prepared before pruning so the release cannot ship the fat tree', async () => {
    const arm = await seed('darwin', 'arm64')
    const piCli = join(arm, 'pi', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
    expect(run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '').status).toBe(0)

    await writeFile(`${piCli}.map`, '{"version":3}')
    const stale = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain('development-only sourcemaps')
  })

  it('rejects a runtime without the pinned Hermes closure or with the wrong native SQLite slice', async () => {
    const arm = await seed('darwin', 'arm64')
    const nodeModules = join(arm, 'pi', 'lib', 'node_modules')
    expect(run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '').status).toBe(0)

    await rm(join(nodeModules, 'pi-hermes-memory'), { recursive: true, force: true })
    const missing = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('pi-hermes-memory installed version is missing, expected 0.11.0')

    await mkdir(join(nodeModules, 'pi-hermes-memory'), { recursive: true })
    await writeFile(join(nodeModules, 'pi-hermes-memory', 'package.json'), JSON.stringify({ name: 'pi-hermes-memory', version: '0.11.0' }))
    const sqliteNative = join(nodeModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
    const wrongHeader = Buffer.alloc(32)
    wrongHeader.writeUInt32LE(0xfeedfacf, 0)
    wrongHeader.writeUInt32LE(0x01000007, 4)
    await writeFile(sqliteNative, wrongHeader)
    const wrongArch = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(wrongArch.status).toBe(1)
    expect(wrongArch.stderr).toContain('better-sqlite3 native addon is x64, expected arm64')
  })

  it('detects a version-stale target while leaving an independent target usable', async () => {
    const arm = await seed('darwin', 'arm64')
    await seed('darwin', 'x64')
    const stale = JSON.parse(await readFile(join(arm, 'manifest.json'), 'utf8'))
    stale.nodeVersion = '22.18.0'
    await writeFile(join(arm, 'manifest.json'), JSON.stringify(stale))

    const armCheck = run(['--platform', 'darwin', '--arch', 'arm64', '--check'], '')
    expect(armCheck.status).toBe(1)
    expect(armCheck.stderr).toContain('Node is 22.18.0, expected 24.19.0')
    const x64Check = run(['--platform', 'darwin', '--arch', 'x64', '--check'], '')
    expect(x64Check.status).toBe(0)
  })
})
