import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('safeStorage must not be used')
    },
    decryptString: () => {
      throw new Error('safeStorage must not be used')
    },
  },
}))

describe('electron vault key provider', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    vi.resetModules()
  })

  async function tmp() {
    const dir = await mkdtemp(join(tmpdir(), 'pipi-electron-vault-'))
    dirs.push(dir)
    return dir
  }

  it('reports the in-memory vault and never writes a sealed DEK', async () => {
    const { diagnoseElectronVault, probeElectronVaultAtStartup } = await import('./secret-vault-key.js')
    const dir = await tmp()
    const diagnosis = diagnoseElectronVault()
    expect(diagnosis.available).toBe(true)
    expect(diagnosis.message).toContain('仅保存在当前 App 主进程内存')
    expect(probeElectronVaultAtStartup().available).toBe(true)
    await expect(stat(join(dir, 'secret-vault.key'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(dir, 'secret-vault-dek.sealed'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(diagnoseElectronVault.toString()).not.toMatch(/safeStorage/)
  })
})
