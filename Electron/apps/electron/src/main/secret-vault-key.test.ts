import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const safeStorage = {
  available: false,
  encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`)),
  decryptString: vi.fn((sealed: Buffer) => sealed.toString().slice('sealed:'.length)),
  isEncryptionAvailable: () => safeStorage.available,
}

vi.mock('electron', () => ({ safeStorage }))

describe('electron vault key provider', () => {
  const dirs: string[] = []
  afterEach(async () => {
    safeStorage.available = false
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    vi.resetModules()
  })

  async function tmp() {
    const dir = await mkdtemp(join(tmpdir(), 'pipi-electron-vault-'))
    dirs.push(dir)
    return dir
  }

  it('fails closed when encryption is unavailable and never writes a sibling key', async () => {
    const { createElectronVaultKeyProvider, diagnoseElectronVault } = await import('./secret-vault-key.js')
    const dir = await tmp()
    const provider = createElectronVaultKeyProvider(dir)
    expect(() => provider.getDek()).toThrow(/unavailable/)
    await expect(stat(join(dir, 'secret-vault.key'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(dir, 'secret-vault-dek.sealed'))).rejects.toMatchObject({ code: 'ENOENT' })
    const diagnosis = diagnoseElectronVault({
      platform: 'linux',
      env: {},
      encryptionAvailable: () => false,
    })
    expect(diagnosis.available).toBe(false)
    expect(diagnosis.kind).toBe('no-graphical-session')
  })

  it('recovers after Secret Service becomes available and keeps the sealed DEK at 0600', async () => {
    const { createElectronVaultKeyProvider, diagnoseElectronVault } = await import('./secret-vault-key.js')
    const dir = await tmp()
    const provider = createElectronVaultKeyProvider(dir)
    expect(() => provider.getDek()).toThrow(/unavailable/)
    safeStorage.available = true
    const dek = provider.getDek()
    expect(dek).toHaveLength(32)
    const sealed = join(dir, 'secret-vault-dek.sealed')
    const info = await stat(sealed)
    if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o600)
    expect((await readFile(sealed)).includes(dek)).toBe(false)
    expect(diagnoseElectronVault({ encryptionAvailable: () => true }).available).toBe(true)
    expect(provider.getDek().equals(dek)).toBe(true)
  })
})
