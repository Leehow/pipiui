import { describe, expect, it } from 'vitest'
import { memoryVaultDiagnosis } from '../../../../packages/pi-backend/src/secret-vault.js'
import { diagnoseLinuxSecretService, logVaultDiagnosis } from './linux-secret-service.js'

describe('linux secret service diagnosis', () => {
  it('does not require Secret Service or keyring packages', () => {
    const diagnosis = diagnoseLinuxSecretService()
    expect(diagnosis.available).toBe(true)
    expect(diagnosis.kind).toBe('available')
    expect(diagnosis.message).toContain('仅保存在当前 App 主进程内存')
    expect(diagnosis.installHint).toBeUndefined()
    expect(String(diagnoseLinuxSecretService)).not.toMatch(/gnome-keyring|libsecret|secret-tool|dbus-send/)
  })

  it('logs only the diagnosis kind', () => {
    const lines: string[] = []
    logVaultDiagnosis(memoryVaultDiagnosis('linux'), line => lines.push(line))
    expect(lines.join('\n')).toBe('[vault-diag] kind=available platform=linux')
    expect(lines.join('\n')).not.toMatch(/sk-|ghp_|password=/i)
  })
})
