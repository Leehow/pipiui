import { memoryVaultDiagnosis, type VaultDiagnosis } from '../../../../packages/pi-backend/src/secret-vault.js'

/** Linux Secret Service is no longer a product path. Vault state is process RAM only. */
export function diagnoseLinuxSecretService(): VaultDiagnosis {
  return memoryVaultDiagnosis()
}

export function logVaultDiagnosis(diagnosis: VaultDiagnosis, write: (line: string) => void = line => console.warn(line)): void {
  write(`[vault-diag] kind=${diagnosis.kind} platform=${diagnosis.platform}`)
}
