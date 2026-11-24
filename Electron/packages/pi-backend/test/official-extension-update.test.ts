import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { cp, mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { ExtensionLoader } from '../src/extension-loader.js'
import { ExtensionRegistry } from '../src/extension-registry.js'
import { applyExtensionUpdate } from '../src/extension-update-engine.js'

it('loads the signed website release over a mounted builtin and keeps new App seeds from regressing', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pipiui-test-official-')))
  try {
    const seed = join(root, 'extensions'), store = join(root, 'store'), out = join(root, 'release')
    const bundled = fileURLToPath(new URL('../../../resources/runtime/extensions/flapcode/', import.meta.url))
    const latest = JSON.parse(await readFile(join(bundled, 'pipiui-extension.json'), 'utf8'))
    await mkdir(seed)
    await cp(bundled, join(seed, 'flapcode'), { recursive: true })
    const seedManifest = join(seed, 'flapcode/pipiui-extension.json')
    await writeFile(seedManifest, JSON.stringify({ ...latest, version: '0.1.0' }))
    const keys = generateKeyPairSync('ed25519')
    const signingKey = join(root, 'sign.pem')
    await writeFile(signingKey, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
    execFileSync(process.execPath, [fileURLToPath(new URL('../../../scripts/prepare-official-update.mjs', import.meta.url)), 'extension', out, bundled], {
      env: { ...process.env, PIPIUI_EXTENSION_SIGNING_KEY_FILE: signingKey, PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') },
    })
    const versions = JSON.parse(await readFile(join(out, 'pipiui-extensions.json'), 'utf8')).versions
    const loader = new ExtensionLoader({ registry: new ExtensionRegistry([]), builtinRoot: seed, sharedStoreRoot: store, appRoot: join(root, 'local') })
    loader.scan()
    expect(loader.list().find(item => item.id === 'flapcode')?.version).toBe('0.1.0')
    const result = await applyExtensionUpdate({ extensionId: 'flapcode', source: { type: 'official' },
      currentVersion: '0.1.0', targetVersion: versions.flapcode }, {
      storeRoot: store, seedRoot: seed, signingPublicKey: keys.publicKey,
      fetchImpl: async (url) => new Response(await readFile(join(out, basename(new URL(url).pathname)))),
    })
    loader.scan()
    expect(loader.list().find(item => item.id === 'flapcode')?.version).toBe(latest.version)
    expect(loader.directoryOf('flapcode')).toBe(result.objectDir)
    expect(loader.spawnPackages({ flapcode: true }).find(item => item.id === 'flapcode')?.extensionPath).toBe(join(result.objectDir, latest.agent.extension))
    await writeFile(seedManifest, JSON.stringify({ ...latest, version: '99.0.0' }))
    loader.scan()
    expect(loader.directoryOf('flapcode')).toBe(join(seed, 'flapcode'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
