import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  type VaultDiagnosis,
  type VaultDiagKind,
  ubuntuVaultInstallHint,
  vaultDiagnosisFor,
} from '../../../../packages/pi-backend/src/secret-vault.js'

export type LinuxSecretProbe = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  encryptionAvailable?: () => boolean
  commandExists?: (name: string) => boolean
  fileExists?: (path: string) => boolean
  readText?: (path: string) => string | undefined
  secretServiceStatus?: () => 'ok' | 'locked' | 'unreachable'
}

const LIBSECRET_CANDIDATES = [
  '/usr/lib/x86_64-linux-gnu/libsecret-1.so.0',
  '/usr/lib/libsecret-1.so.0',
  '/lib/x86_64-linux-gnu/libsecret-1.so.0',
]

const SESSION_BUS_CANDIDATES = (runtimeDir: string | undefined) => [
  runtimeDir ? `${runtimeDir}/bus` : '',
  runtimeDir ? `${runtimeDir}/dbus-1` : '',
].filter(Boolean)

function defaultCommandExists(name: string): boolean {
  const result = spawnSync('sh', ['-c', `command -v ${JSON.stringify(name)} >/dev/null 2>&1`], { encoding: 'utf8' })
  return result.status === 0
}

function defaultSecretServiceStatus(env: NodeJS.ProcessEnv): 'ok' | 'locked' | 'unreachable' {
  const dbus = spawnSync('dbus-send', [
    '--session',
    '--dest=org.freedesktop.secrets',
    '--print-reply',
    '--type=method_call',
    '/',
    'org.freedesktop.DBus.Peer.Ping',
  ], { encoding: 'utf8', env, timeout: 1500 })
  if (dbus.status !== 0) return 'unreachable'
  const locked = spawnSync('busctl', [
    '--user',
    'get-property',
    'org.freedesktop.secrets',
    '/org/freedesktop/secrets/collection/login',
    'org.freedesktop.Secret.Collection',
    'Locked',
  ], { encoding: 'utf8', env, timeout: 1500 })
  if (locked.status === 0 && /true/i.test(locked.stdout || '')) return 'locked'
  return 'ok'
}

export function readOsRelease(readText: (path: string) => string | undefined): { id?: string; like?: string } {
  const raw = readText('/etc/os-release') ?? readText('/usr/lib/os-release') ?? ''
  const id = /^\s*ID=(?:"([^"]+)"|([^\s]+))/m.exec(raw)
  const like = /^\s*ID_LIKE=(?:"([^"]+)"|([^\s]+))/m.exec(raw)
  return {
    id: (id?.[1] ?? id?.[2])?.toLowerCase(),
    like: (like?.[1] ?? like?.[2])?.toLowerCase(),
  }
}

export function installHintForRelease(release: { id?: string; like?: string }): string {
  if (release.id === 'fedora' || release.like?.includes('fedora')) {
    return 'sudo dnf install gnome-keyring libsecret'
  }
  if (release.id === 'arch' || release.like?.includes('arch')) {
    return 'sudo pacman -S gnome-keyring libsecret'
  }
  return ubuntuVaultInstallHint()
}

export function hasGraphicalSession(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION)
}

export function hasSessionBus(env: NodeJS.ProcessEnv, fileExists: (path: string) => boolean): boolean {
  if (env.DBUS_SESSION_BUS_ADDRESS) return true
  return SESSION_BUS_CANDIDATES(env.XDG_RUNTIME_DIR).some(path => fileExists(path))
}

export function hasVaultPackages(commandExists: (name: string) => boolean, fileExists: (path: string) => boolean): boolean {
  const hasKeyring = commandExists('gnome-keyring-daemon') || commandExists('gnome-keyring')
  const hasLibsecret = LIBSECRET_CANDIDATES.some(path => fileExists(path))
  const hasTools = commandExists('secret-tool')
  return hasKeyring && hasLibsecret && hasTools
}

export function classifyLinuxVaultUnavailable(probe: LinuxSecretProbe = {}): VaultDiagKind {
  const env = probe.env ?? process.env
  const fileExists = probe.fileExists ?? existsSync
  const commandExists = probe.commandExists ?? defaultCommandExists
  if (!hasGraphicalSession(env)) return 'no-graphical-session'
  if (!hasSessionBus(env, fileExists)) return 'session-bus-unavailable'
  if (!hasVaultPackages(commandExists, fileExists)) return 'missing-packages'
  const status = (probe.secretServiceStatus ?? (() => defaultSecretServiceStatus(env)))()
  if (status === 'locked') return 'keyring-locked'
  if (status === 'unreachable') return 'secret-service-unreachable'
  return 'encryption-unavailable'
}

export function diagnoseLinuxSecretService(probe: LinuxSecretProbe = {}): VaultDiagnosis {
  const platform = probe.platform ?? process.platform
  const available = probe.encryptionAvailable?.() ?? false
  if (available) return vaultDiagnosisFor('available', platform)
  if (platform !== 'linux') return vaultDiagnosisFor('encryption-unavailable', platform)
  const kind = classifyLinuxVaultUnavailable(probe)
  const diagnosis = vaultDiagnosisFor(kind, platform)
  if (kind === 'missing-packages' || kind === 'secret-service-unreachable' || kind === 'encryption-unavailable') {
    const readText = probe.readText ?? ((path: string) => {
      try { return readFileSync(path, 'utf8') } catch { return undefined }
    })
    diagnosis.installHint = installHintForRelease(readOsRelease(readText))
  }
  return diagnosis
}

export function logVaultDiagnosis(diagnosis: VaultDiagnosis, write: (line: string) => void = line => console.warn(line)): void {
  write(`[vault-diag] kind=${diagnosis.kind} platform=${diagnosis.platform}`)
}
