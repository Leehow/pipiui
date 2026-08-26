import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const scriptSource = resolve(import.meta.dirname, 'sync-bundled-extension.mjs')
const temporaryRoots: string[] = []

const EPOCH_2000 = 946684800 // 2000-01-01T00:00:00.000Z
const EPOCH_2001 = 978307200 // 2001-01-01T00:00:00.000Z

interface Fixture {
  root: string
  electron: string
  script: string
  packageDir: string
  dest: string
  hostFile: string
  manifestPath: string
}

async function write(root: string, relative: string, content: string) {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

function manifestJson(): string {
  return JSON.stringify(
    {
      id: 'fixture-ext',
      name: 'Fixture Ext',
      version: '1.2.3',
      agent: { extension: 'agent/dist/index.js' },
      host: { entry: 'agent/dist/host.js' },
      app: {
        ui: { panels: [{ slot: 'toolPanel', id: 'fixture-panel', title: 'Fixture', entry: 'app/dist/panel.js' }] },
      },
    },
    null,
    2,
  )
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'pipiui-sync-bundled-'))
  temporaryRoots.push(root)
  const electron = join(root, 'Electron')
  await write(electron, 'scripts/sync-bundled-extension.mjs', await readFile(scriptSource, 'utf8'))
  const packageDir = join(electron, 'packages', 'fixture-ext-extension')
  await write(packageDir, 'pipiui-extension.json', manifestJson())
  await write(packageDir, 'package.json', JSON.stringify({ name: 'fixture-ext', private: true }, null, 2))
  await write(packageDir, 'README.md', '# fixture-ext\n')
  await write(packageDir, 'LICENSE', 'fixture license\n')
  await write(packageDir, 'NOTICE', 'fixture notice\n')
  await write(packageDir, 'agent/dist/index.js', 'export function activate() { return 1 }\n')
  await write(packageDir, 'agent/dist/host.js', 'export const hostLibrary = "v1"\n')
  await write(packageDir, 'app/dist/panel.js', 'export const panel = "v1"\n')
  return {
    root,
    electron,
    script: join(electron, 'scripts', 'sync-bundled-extension.mjs'),
    packageDir,
    dest: join(electron, 'resources', 'runtime', 'extensions', 'fixture-ext'),
    hostFile: join(packageDir, 'agent', 'dist', 'host.js'),
    manifestPath: join(packageDir, 'pipiui-extension.json'),
  }
}

function runSync(fx: Fixture, env: Record<string, string | undefined> = {}) {
  const envFull: NodeJS.ProcessEnv = { ...process.env }
  delete envFull.SOURCE_DATE_EPOCH
  Object.assign(envFull, env)
  return execFileAsync(process.execPath, [fx.script, 'fixture-ext-extension'], {
    cwd: fx.root,
    env: envFull,
  })
}

/** rel posix path -> sha256 of file bytes, for byte-level tree comparison. */
async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  const walk = async (current: string, rel: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(current, entry.name), entryRel)
      else if (entry.isFile()) {
        const bytes = await readFile(join(current, entry.name))
        snapshot[entryRel] = createHash('sha256').update(bytes).digest('hex')
      }
    }
  }
  await walk(dir, '')
  return snapshot
}

async function readReceipt(fx: Fixture) {
  return JSON.parse(await readFile(join(fx.dest, 'pipiui-host-receipt.json'), 'utf8')) as {
    version: number
    extensionId: string
    manifestVersion: string
    hostEntry: string
    sha256: string
    bytes: number
    contentHash?: string
    generatedAt: string
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('bundled extension receipt reproducibility', () => {
  it('consecutive syncs with unchanged manifest/files/host hashes are byte-identical and preserve generatedAt', async () => {
    const fx = await makeFixture()
    // First sync pins a deterministic timestamp via SOURCE_DATE_EPOCH.
    await runSync(fx, { SOURCE_DATE_EPOCH: String(EPOCH_2000) })
    const before = await snapshotTree(fx.dest)
    const receiptBefore = await readReceipt(fx)
    expect(receiptBefore.generatedAt).toBe(new Date(EPOCH_2000 * 1000).toISOString())

    // Rebuild without SOURCE_DATE_EPOCH: the wall clock would stamp a fresh
    // timestamp, but unchanged content must preserve the existing receipt
    // byte-for-byte.
    await runSync(fx)
    const after = await snapshotTree(fx.dest)
    const receiptAfter = await readReceipt(fx)
    expect(after).toEqual(before)
    expect(receiptAfter.generatedAt).toBe(receiptBefore.generatedAt)

    // The receipt keeps pinning the truthful host-entry hash (verification
    // is not weakened by the preservation path).
    const hostBytes = await readFile(join(fx.dest, 'agent', 'dist', 'host.js'))
    expect(receiptAfter.sha256).toBe(createHash('sha256').update(hostBytes).digest('hex'))
    expect(receiptAfter.bytes).toBe(hostBytes.byteLength)
    expect(receiptAfter.hostEntry).toBe('agent/dist/host.js')
    expect(receiptAfter.extensionId).toBe('fixture-ext')
    expect(receiptAfter.manifestVersion).toBe('1.2.3')
    expect(await readFile(join(fx.dest, 'LICENSE'), 'utf8')).toBe('fixture license\n')
    expect(await readFile(join(fx.dest, 'NOTICE'), 'utf8')).toBe('fixture notice\n')
  })

  it('content changes move generatedAt and the pinned hashes', async () => {
    const fx = await makeFixture()
    await runSync(fx, { SOURCE_DATE_EPOCH: String(EPOCH_2000) })
    const first = await readReceipt(fx)

    // Host entry changes -> new sha256/bytes/contentHash and a new stamp.
    await write(fx.packageDir, 'agent/dist/host.js', 'export const hostLibrary = "v2-more-bytes"\n')
    await runSync(fx, { SOURCE_DATE_EPOCH: String(EPOCH_2001) })
    const afterHost = await readReceipt(fx)
    const newHostBytes = await readFile(join(fx.dest, 'agent', 'dist', 'host.js'))
    expect(afterHost.sha256).toBe(createHash('sha256').update(newHostBytes).digest('hex'))
    expect(afterHost.bytes).toBe(newHostBytes.byteLength)
    expect(afterHost.contentHash).not.toBe(first.contentHash)
    expect(afterHost.generatedAt).toBe(new Date(EPOCH_2001 * 1000).toISOString())

    // Non-host file changes (host hash unchanged) still refresh generatedAt:
    // the tree digest covers every shipped file.
    await write(fx.packageDir, 'app/dist/panel.js', 'export const panel = "v2"\n')
    await runSync(fx)
    const afterFiles = await readReceipt(fx)
    expect(afterFiles.sha256).toBe(afterHost.sha256)
    expect(afterFiles.bytes).toBe(afterHost.bytes)
    expect(afterFiles.contentHash).not.toBe(afterHost.contentHash)
    expect(afterFiles.generatedAt).not.toBe(afterHost.generatedAt)

    // Manifest content changes without a version bump still refresh
    // generatedAt (manifest bytes are part of the tree digest).
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8'))
    manifest.host.description = 'cross-host library entry'
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await runSync(fx)
    const afterManifest = await readReceipt(fx)
    expect(afterManifest.contentHash).not.toBe(afterFiles.contentHash)
    expect(afterManifest.generatedAt).not.toBe(afterFiles.generatedAt)
  })

  it('SOURCE_DATE_EPOCH makes independent syncs of the same content byte-identical', async () => {
    const fx1 = await makeFixture()
    const fx2 = await makeFixture()
    await runSync(fx1, { SOURCE_DATE_EPOCH: String(EPOCH_2001) })
    await runSync(fx2, { SOURCE_DATE_EPOCH: String(EPOCH_2001) })

    const tree1 = await snapshotTree(fx1.dest)
    const tree2 = await snapshotTree(fx2.dest)
    expect(tree2).toEqual(tree1)

    const receipt1 = await readReceipt(fx1)
    const receipt2 = await readReceipt(fx2)
    expect(receipt1.generatedAt).toBe(new Date(EPOCH_2001 * 1000).toISOString())
    expect(receipt2.generatedAt).toBe(receipt1.generatedAt)
    expect(receipt2.contentHash).toBe(receipt1.contentHash)

    // Repeated syncs with the same SOURCE_DATE_EPOCH stay byte-identical too.
    await runSync(fx1, { SOURCE_DATE_EPOCH: String(EPOCH_2001) })
    expect(await snapshotTree(fx1.dest)).toEqual(tree1)
  })

  it('rejects malformed SOURCE_DATE_EPOCH before touching the runtime tree', async () => {
    const fx = await makeFixture()
    await runSync(fx, { SOURCE_DATE_EPOCH: String(EPOCH_2000) })
    const before = await snapshotTree(fx.dest)
    await expect(runSync(fx, { SOURCE_DATE_EPOCH: 'not-a-number' })).rejects.toMatchObject({ code: 1 })
    await expect(runSync(fx, { SOURCE_DATE_EPOCH: '175500000000000000000000' })).rejects.toMatchObject({ code: 1 })
    expect(await snapshotTree(fx.dest)).toEqual(before)
  })

  it('still refuses to sync when a declared build artifact is missing', async () => {
    const fx = await makeFixture()
    await rm(join(fx.packageDir, 'agent', 'dist', 'index.js'))
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('copies a declared documentRenderers entry into the runtime tree', async () => {
    const fx = await makeFixture()
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        ...(manifest.app?.ui ?? {}),
        documentRenderers: [{ id: 'office', entry: 'app/dist/office-renderer.js', kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await write(fx.packageDir, 'app/dist/office-renderer.js', 'export default function Office() { return null }\n')
    await runSync(fx)
    const destFile = join(fx.dest, 'app', 'dist', 'office-renderer.js')
    expect(await readFile(destFile, 'utf8')).toContain('export default function Office')
  })

  it('refuses a document renderer entry that escapes the package with ..', async () => {
    const fx = await makeFixture()
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        documentRenderers: [{ id: 'evil', entry: '../secret.js', kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('refuses a POSIX absolute document renderer entry', async () => {
    const fx = await makeFixture()
    const outside = join(fx.root, 'outside-absolute.js')
    await writeFile(outside, 'export default 1\n')
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        documentRenderers: [{ id: 'evil', entry: outside, kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('refuses a document renderer entry that is a symlink to an outside file', async () => {
    const fx = await makeFixture()
    const outside = join(fx.root, 'stolen.js')
    await writeFile(outside, 'export const stolen = 1\n')
    await symlink(outside, join(fx.packageDir, 'app', 'dist', 'office-renderer.js'))
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        ...(manifest.app?.ui ?? {}),
        documentRenderers: [{ id: 'office', entry: 'app/dist/office-renderer.js', kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('refuses a nested dist asset symlink that escapes the package', async () => {
    const fx = await makeFixture()
    const outside = join(fx.root, 'escape.wasm')
    await writeFile(outside, 'wasm')
    await mkdir(join(fx.packageDir, 'app', 'dist', 'file-viewer', 'vendor'), { recursive: true })
    await symlink(outside, join(fx.packageDir, 'app', 'dist', 'file-viewer', 'vendor', 'escape.wasm'))
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('copies hashed renderer chunks and vendor assets beside the entry', async () => {
    const fx = await makeFixture()
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        ...(manifest.app?.ui ?? {}),
        documentRenderers: [{ id: 'office', entry: 'app/dist/office-renderer.js', kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await write(fx.packageDir, 'app/dist/office-renderer.js', 'export { O as default } from "./office-renderer-DS5--c0p.js"\n')
    await write(fx.packageDir, 'app/dist/office-renderer-DS5--c0p.js', 'export const O = function Office() { return null }\n')
    await write(fx.packageDir, 'app/dist/office-renderer.css', '.office { color: navy }')
    await write(fx.packageDir, 'app/dist/file-viewer/vendor/ppt/ppt-native.wasm', 'wasm-bytes')
    await runSync(fx)
    expect(await readFile(join(fx.dest, 'app', 'dist', 'office-renderer.js'), 'utf8')).toContain('office-renderer-DS5--c0p')
    expect(await readFile(join(fx.dest, 'app', 'dist', 'office-renderer-DS5--c0p.js'), 'utf8')).toContain('function Office')
    expect(await readFile(join(fx.dest, 'app', 'dist', 'office-renderer.css'), 'utf8')).toContain('.office')
    expect(await readFile(join(fx.dest, 'app', 'dist', 'file-viewer', 'vendor', 'ppt', 'ppt-native.wasm'), 'utf8')).toBe('wasm-bytes')
  })

  it('accepts a declared entry whose filename contains .. as characters, not a path segment', async () => {
    const fx = await makeFixture()
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        ...(manifest.app?.ui ?? {}),
        documentRenderers: [{ id: 'office', entry: 'app/dist/chunk..js', kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await write(fx.packageDir, 'app/dist/chunk..js', 'export default function Chunk() { return null }\n')
    await runSync(fx)
    expect(await readFile(join(fx.dest, 'app', 'dist', 'chunk..js'), 'utf8')).toContain('function Chunk')
  })

  it.each([
    'C:\\Windows\\evil.js',
    'C:/Windows/evil.js',
    '\\\\server\\share\\evil.js',
    '//server/share/evil.js',
  ])('refuses Windows/UNC absolute document renderer entry %s', async (entry) => {
    const fx = await makeFixture()
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        documentRenderers: [{ id: 'evil', entry, kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('refuses a directory as a declared entry', async () => {
    const fx = await makeFixture()
    const manifest = JSON.parse(await readFile(fx.manifestPath, 'utf8')) as {
      app?: { ui?: Record<string, unknown> }
    }
    manifest.app = {
      ui: {
        documentRenderers: [{ id: 'evil', entry: 'app/dist', kinds: ['word'] }],
      },
    }
    await writeFile(fx.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
  })

  it('refuses a final destination that is a symlink and leaves the external sentinel untouched', async () => {
    const fx = await makeFixture()
    const outside = join(fx.root, 'stolen-dest')
    await mkdir(outside, { recursive: true })
    const sentinel = join(outside, 'SENTINEL')
    await writeFile(sentinel, 'untouched\n')
    await mkdir(join(fx.electron, 'resources', 'runtime', 'extensions'), { recursive: true })
    await symlink(outside, fx.dest)
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
    expect(await readFile(sentinel, 'utf8')).toBe('untouched\n')
    expect(await readdir(outside)).toEqual(['SENTINEL'])
  })

  it('refuses a symlinked extensions parent and leaves the external sentinel untouched', async () => {
    const fx = await makeFixture()
    const outside = join(fx.root, 'stolen-extensions')
    await mkdir(outside, { recursive: true })
    const sentinel = join(outside, 'SENTINEL')
    await writeFile(sentinel, 'untouched\n')
    await mkdir(join(fx.electron, 'resources', 'runtime'), { recursive: true })
    await symlink(outside, join(fx.electron, 'resources', 'runtime', 'extensions'))
    await expect(runSync(fx)).rejects.toMatchObject({ code: 1 })
    expect(await readFile(sentinel, 'utf8')).toBe('untouched\n')
    expect(await readdir(outside)).toEqual(['SENTINEL'])
  })
})
