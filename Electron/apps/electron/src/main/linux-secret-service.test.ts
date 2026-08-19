import { describe, expect, it } from 'vitest'
import { vaultDiagnosisFor, vaultDiagnosisMessage } from '../../../../packages/pi-backend/src/secret-vault.js'
import {
  classifyLinuxVaultUnavailable,
  diagnoseLinuxSecretService,
  hasGraphicalSession,
  hasSessionBus,
  hasVaultPackages,
  installHintForRelease,
  logVaultDiagnosis,
  readOsRelease,
} from './linux-secret-service.js'

describe('linux secret service diagnosis', () => {
  it('classifies missing packages, session bus, keyring lock, and headless sessions', () => {
    expect(classifyLinuxVaultUnavailable({
      env: {},
      fileExists: () => false,
      commandExists: () => false,
    })).toBe('no-graphical-session')
    expect(classifyLinuxVaultUnavailable({
      env: { DISPLAY: ':0' },
      fileExists: () => false,
      commandExists: () => false,
    })).toBe('session-bus-unavailable')
    expect(classifyLinuxVaultUnavailable({
      env: { DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/bus' },
      fileExists: () => false,
      commandExists: () => false,
    })).toBe('missing-packages')
    expect(classifyLinuxVaultUnavailable({
      env: { DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/bus' },
      fileExists: () => true,
      commandExists: () => true,
      secretServiceStatus: () => 'unreachable',
    })).toBe('secret-service-unreachable')
    expect(classifyLinuxVaultUnavailable({
      env: { DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/bus' },
      fileExists: () => true,
      commandExists: () => true,
      secretServiceStatus: () => 'locked',
    })).toBe('keyring-locked')
  })

  it('returns available when encryption is present and never auto-installs', () => {
    const source = [
      ...Object.values({ classifyLinuxVaultUnavailable, diagnoseLinuxSecretService }),
    ].map(String).join('\n')
    expect(source).not.toMatch(/\b(apt|dnf|pacman|sudo)\b/)
    expect(diagnoseLinuxSecretService({
      platform: 'linux',
      encryptionAvailable: () => true,
    }).available).toBe(true)
  })

  it('uses Ubuntu install hints by default and keeps diagnosis text free of secret values', () => {
    const missing = diagnoseLinuxSecretService({
      platform: 'linux',
      env: { DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/bus' },
      encryptionAvailable: () => false,
      fileExists: () => false,
      commandExists: () => false,
      readText: () => 'ID=ubuntu\nVERSION_ID="24.04"\n',
    })
    expect(missing.kind).toBe('missing-packages')
    expect(missing.installHint).toBe('sudo apt install gnome-keyring libsecret-1-0 libsecret-tools')
    expect(missing.message).toContain('重试检测')
    expect(missing.message).not.toMatch(/sk-|ghp_|password=|token=/i)
    expect(installHintForRelease({ id: 'fedora', like: 'fedora' })).toContain('dnf')
    expect(readOsRelease(() => 'ID="ubuntu"\nID_LIKE=debian\n')).toEqual({ id: 'ubuntu', like: 'debian' })
  })

  it('logs only the diagnosis kind', () => {
    const lines: string[] = []
    logVaultDiagnosis(vaultDiagnosisFor('keyring-locked', 'linux'), line => lines.push(line))
    expect(lines.join('\n')).toBe('[vault-diag] kind=keyring-locked platform=linux')
    expect(lines.join('\n')).not.toContain('Secret')
    expect(vaultDiagnosisMessage('no-graphical-session')).toContain('普通聊天')
  })

  it('detects graphical session and session bus independently', () => {
    expect(hasGraphicalSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true)
    expect(hasGraphicalSession({})).toBe(false)
    expect(hasSessionBus({ XDG_RUNTIME_DIR: '/run/user/1000' }, path => path === '/run/user/1000/bus')).toBe(true)
    expect(hasVaultPackages(name => name === 'secret-tool', path => path.includes('libsecret-1.so.0'))).toBe(false)
    expect(hasVaultPackages(
      name => name === 'gnome-keyring-daemon' || name === 'secret-tool',
      path => path.endsWith('libsecret-1.so.0'),
    )).toBe(true)
  })
})
