import type { ComputerUsePermissionKind, ComputerUseState, HostBackend } from '@pipi/host-api'

export type ComputerUsePermissionSnapshot = Pick<ComputerUseState, 'screenRecording' | 'accessibility'>

export type ComputerUsePermissionHost = {
  snapshot(): ComputerUsePermissionSnapshot
  request(kind: ComputerUsePermissionKind): Promise<void> | void
  openSettings(kind: ComputerUsePermissionKind): Promise<void> | void
}

export function computerUsePermissionSettingsURL(kind: ComputerUsePermissionKind): string {
  return kind === 'screenRecording'
    ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
}

function isComputerUsePermissionKind(value: unknown): value is ComputerUsePermissionKind {
  return value === 'screenRecording' || value === 'accessibility'
}

function asComputerUseState(value: unknown): ComputerUseState {
  if (!value || typeof value !== 'object' || typeof (value as ComputerUseState).enabled !== 'boolean') {
    throw new Error('computer-use state is unavailable')
  }
  return value as ComputerUseState
}

/** Add macOS TCC probes and System Settings openers without exposing a generic URL opener. */
export function withComputerUsePermissions(backend: HostBackend, host: ComputerUsePermissionHost): HostBackend {
  return {
    async handle(method, params) {
      if (method === 'getComputerUseState') {
        const state = asComputerUseState(await backend.handle(method, params))
        return { ...state, ...host.snapshot() }
      }
      if (method === 'openComputerUsePermission') {
        const kind = params[0]
        if (!isComputerUsePermissionKind(kind)) throw new Error('unsupported computer-use permission')
        try {
          await host.request(kind)
        } catch {
          // A denied or already-prompted TCC request must not block System Settings.
        }
        await host.openSettings(kind)
        const state = asComputerUseState(await backend.handle('getComputerUseState', []))
        return { ...state, ...host.snapshot() }
      }
      return backend.handle(method, params)
    },
    subscribe: listener => backend.subscribe(listener),
  }
}

export function createElectronComputerUsePermissionHost(deps: {
  platform?: NodeJS.Platform
  getMediaAccessStatus?: (media: 'screen') => string
  isTrustedAccessibilityClient?: (prompt: boolean) => boolean
  requestScreenRecording?: () => Promise<void> | void
  openURL?: (url: string) => Promise<unknown>
} = {}): ComputerUsePermissionHost {
  const platform = deps.platform ?? process.platform
  return {
    snapshot() {
      if (platform !== 'darwin') return {}
      return {
        screenRecording: deps.getMediaAccessStatus?.('screen') === 'granted',
        accessibility: deps.isTrustedAccessibilityClient?.(false) === true,
      }
    },
    async request(kind) {
      if (platform !== 'darwin') return
      if (kind === 'accessibility') {
        deps.isTrustedAccessibilityClient?.(true)
        return
      }
      await deps.requestScreenRecording?.()
    },
    async openSettings(kind) {
      if (platform !== 'darwin') throw new Error('系统权限设置仅在 macOS 上可用')
      await deps.openURL?.(computerUsePermissionSettingsURL(kind))
    },
  }
}
