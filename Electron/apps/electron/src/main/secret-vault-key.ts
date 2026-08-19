import { memoryVaultDiagnosis, type VaultDiagnosis } from '../../../../packages/pi-backend/src/secret-vault.js'

/** OS key services are unused. Vault state lives only in host process RAM. */
export function diagnoseElectronVault(): VaultDiagnosis {
  return memoryVaultDiagnosis()
}

export function probeElectronVaultAtStartup(): VaultDiagnosis {
  return diagnoseElectronVault()
}
