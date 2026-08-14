import { describe, expect, it, vi } from 'vitest'
import type { HostBackend } from '@pipi/host-api'
import {
  computerUsePermissionSettingsURL,
  createElectronComputerUsePermissionHost,
  withComputerUsePermissions,
} from './computer-use-permissions.js'

describe('computerUsePermissionSettingsURL', () => {
  it('maps each permission to the matching System Settings pane', () => {
    expect(computerUsePermissionSettingsURL('screenRecording')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    )
    expect(computerUsePermissionSettingsURL('accessibility')).toBe(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    )
  })
})

describe('withComputerUsePermissions', () => {
  const backend: HostBackend = {
    handle: vi.fn(async method => method === 'getComputerUseState' ? { enabled: true } : 'forwarded'),
    subscribe: () => () => undefined,
  }

  it('merges live permission probes into getComputerUseState', async () => {
    const wrapped = withComputerUsePermissions(backend, {
      snapshot: () => ({ screenRecording: false, accessibility: true }),
      request: vi.fn(),
      openSettings: vi.fn(),
    })
    await expect(wrapped.handle('getComputerUseState', [])).resolves.toEqual({
      enabled: true,
      screenRecording: false,
      accessibility: true,
    })
    await expect(wrapped.handle('listProjects', [])).resolves.toBe('forwarded')
  })

  it('requests the permission and opens the matching System Settings pane', async () => {
    const request = vi.fn()
    const openSettings = vi.fn()
    const wrapped = withComputerUsePermissions(backend, {
      snapshot: () => ({ screenRecording: false, accessibility: false }),
      request,
      openSettings,
    })
    await expect(wrapped.handle('openComputerUsePermission', ['screenRecording'])).resolves.toEqual({
      enabled: true,
      screenRecording: false,
      accessibility: false,
    })
    expect(request).toHaveBeenCalledWith('screenRecording')
    expect(openSettings).toHaveBeenCalledWith('screenRecording')
  })

  it('still opens System Settings when the TCC request itself fails', async () => {
    const openSettings = vi.fn()
    const wrapped = withComputerUsePermissions(backend, {
      snapshot: () => ({ screenRecording: false }),
      request: async () => { throw new Error('TCC denied') },
      openSettings,
    })
    await expect(wrapped.handle('openComputerUsePermission', ['accessibility'])).resolves.toMatchObject({
      enabled: true,
      screenRecording: false,
    })
    expect(openSettings).toHaveBeenCalledWith('accessibility')
  })

  it('rejects unknown permission kinds before touching the system', async () => {
    const request = vi.fn()
    const openSettings = vi.fn()
    const wrapped = withComputerUsePermissions(backend, {
      snapshot: () => ({}),
      request,
      openSettings,
    })
    await expect(wrapped.handle('openComputerUsePermission', ['microphone'])).rejects.toThrow(
      'unsupported computer-use permission',
    )
    expect(request).not.toHaveBeenCalled()
    expect(openSettings).not.toHaveBeenCalled()
  })
})

describe('createElectronComputerUsePermissionHost', () => {
  it('probes macOS TCC and opens the matching settings URL', async () => {
    const openURL = vi.fn(async () => undefined)
    const requestScreenRecording = vi.fn(async () => undefined)
    const isTrustedAccessibilityClient = vi.fn((prompt: boolean) => prompt === false ? false : true)
    const host = createElectronComputerUsePermissionHost({
      platform: 'darwin',
      getMediaAccessStatus: () => 'denied',
      isTrustedAccessibilityClient,
      requestScreenRecording,
      openURL,
    })
    expect(host.snapshot()).toEqual({ screenRecording: false, accessibility: false })
    await host.request('screenRecording')
    await host.openSettings('screenRecording')
    expect(requestScreenRecording).toHaveBeenCalledOnce()
    expect(openURL).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    )
    await host.request('accessibility')
    expect(isTrustedAccessibilityClient).toHaveBeenCalledWith(true)
  })

  it('does not invent permission state off macOS', () => {
    expect(createElectronComputerUsePermissionHost({ platform: 'linux' }).snapshot()).toEqual({})
  })
})
