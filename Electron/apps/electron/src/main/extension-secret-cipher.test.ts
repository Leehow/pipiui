import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: {
    available: true,
    backend: 'gnome_libsecret',
    encryptString: vi.fn((plain: string) => Buffer.from([...Buffer.from(plain, 'utf8')].map(byte => byte ^ 0x3c))),
    decryptString: vi.fn((buf: Buffer) => Buffer.from([...buf].map(byte => byte ^ 0x3c)).toString('utf8')),
  },
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mocks.available,
    getSelectedStorageBackend: () => mocks.backend,
    encryptString: (plain: string) => mocks.encryptString(plain),
    decryptString: (buf: Buffer) => mocks.decryptString(buf),
  },
}))

import {
  EXTENSION_SECRET_DECRYPT_UNAVAILABLE,
  EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE,
  createElectronExtensionSecretCipher,
} from './extension-secret-cipher.js'

const FAKE = 'fake-extension-secret'

describe('extension-secret-cipher', () => {
  beforeEach(() => {
    mocks.available = true
    mocks.backend = 'gnome_libsecret'
    mocks.encryptString.mockClear()
    mocks.decryptString.mockClear()
  })

  it('round-trips through safeStorage and never returns plaintext as the ciphertext', () => {
    const cipher = createElectronExtensionSecretCipher()
    const encrypted = cipher.encrypt(FAKE)
    expect(Buffer.isBuffer(encrypted)).toBe(true)
    expect(encrypted.includes(FAKE)).toBe(false)
    expect(mocks.encryptString).toHaveBeenCalledWith(FAKE)
    expect(cipher.decrypt(encrypted)).toBe(FAKE)
    expect(mocks.decryptString).toHaveBeenCalled()
  })

  it('refuses Linux basic_text even when Electron reports encryption available', () => {
    mocks.backend = 'basic_text'
    const cipher = createElectronExtensionSecretCipher('linux')
    expect(() => cipher.encrypt(FAKE)).toThrow(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE)
    expect(() => cipher.decrypt(Buffer.from('x'))).toThrow(EXTENSION_SECRET_DECRYPT_UNAVAILABLE)
    expect(mocks.encryptString).not.toHaveBeenCalled()
  })

  it('refuses to encrypt or decrypt when OS encryption is unavailable', () => {
    mocks.available = false
    const cipher = createElectronExtensionSecretCipher()
    expect(() => cipher.encrypt(FAKE)).toThrow(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE)
    expect(mocks.encryptString).not.toHaveBeenCalled()
    expect(() => cipher.decrypt(Buffer.from('x'))).toThrow(EXTENSION_SECRET_DECRYPT_UNAVAILABLE)
    expect(mocks.decryptString).not.toHaveBeenCalled()
  })
})
