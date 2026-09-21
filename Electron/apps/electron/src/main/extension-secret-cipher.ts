import { safeStorage } from 'electron'

/**
 * Electron OS encryption wrapper for Jev extension credentials.
 * Never used for the global tool vault (that stays RAM-only).
 * Callers must not fall back to plaintext or a self-stored AES key.
 */
export const EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE = '系统加密不可用，无法持久保存扩展凭据'
export const EXTENSION_SECRET_DECRYPT_UNAVAILABLE = '系统加密不可用，无法解密已保存的扩展凭据'

export function createElectronExtensionSecretCipher(platform: NodeJS.Platform = process.platform) {
  const available = () => {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (platform !== 'linux') return true
    if (typeof safeStorage.getSelectedStorageBackend !== 'function') return false
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  }
  return {
    encrypt(plaintext: string): Buffer {
      if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new Error('plaintext must be a non-empty string')
      }
      if (!available()) {
        throw new Error(EXTENSION_SECRET_ENCRYPTION_UNAVAILABLE)
      }
      return Buffer.from(safeStorage.encryptString(plaintext))
    },
    decrypt(ciphertext: Buffer): string {
      if (!Buffer.isBuffer(ciphertext)) {
        throw new Error('ciphertext must be a Buffer')
      }
      if (!available()) {
        throw new Error(EXTENSION_SECRET_DECRYPT_UNAVAILABLE)
      }
      return safeStorage.decryptString(ciphertext)
    },
  }
}
