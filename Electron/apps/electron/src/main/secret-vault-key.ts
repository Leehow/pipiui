import { safeStorage } from 'electron'
import { join } from 'node:path'
import {
  createSealedDekProvider,
  type VaultDiagnosis,
  type VaultKeyProvider,
} from '../../../../packages/pi-backend/src/secret-vault.js'
import { diagnoseLinuxSecretService, logVaultDiagnosis } from './linux-secret-service.js'

export function electronVaultEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function diagnoseElectronVault(probe?: Parameters<typeof diagnoseLinuxSecretService>[0]): VaultDiagnosis {
  return diagnoseLinuxSecretService({
    platform: process.platform,
    env: process.env,
    encryptionAvailable: electronVaultEncryptionAvailable,
    ...probe,
  })
}

export function createElectronVaultKeyProvider(userData: string): VaultKeyProvider {
  return createSealedDekProvider(join(userData, 'secret-vault-dek.sealed'), {
    available: electronVaultEncryptionAvailable,
    seal: (plain) => {
      if (!electronVaultEncryptionAvailable()) throw new Error('vault encryption unavailable')
      return safeStorage.encryptString(plain.toString('base64'))
    },
    open: (sealed) => {
      if (!electronVaultEncryptionAvailable()) throw new Error('vault encryption unavailable')
      return Buffer.from(safeStorage.decryptString(sealed), 'base64')
    },
  })
}

export function probeElectronVaultAtStartup(): VaultDiagnosis {
  const diagnosis = diagnoseElectronVault()
  if (!diagnosis.available) logVaultDiagnosis(diagnosis)
  return diagnosis
}
