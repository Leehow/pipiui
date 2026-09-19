// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, createMockHost } from './App'
import type { ExtEvent } from './subscribe-ext'
import type { PipiHostAPI } from '@pipi/host-api'

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/**
 * Bind/unbind lands mid-session (boss's first write). The host announces it on the
 * git-capability D4 channel; App must refetch the session lists so the header
 * dual-branch pair appears without an app restart.
 */
describe('App session-workspace change notice', () => {
  it('refetches sessions when git-capability announces a workspace change', async () => {
    const base = createMockHost()
    const listSessions = vi.spyOn(base, 'listSessions')
    const extListeners = new Map<string, (event: ExtEvent) => void>()
    const host = {
      ...base,
      subscribeExt: (extensionId: string, listener: (event: ExtEvent) => void) => {
        extListeners.set(extensionId, listener)
        return () => { extListeners.delete(extensionId) }
      },
    } as unknown as PipiHostAPI
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const initialCalls = listSessions.mock.calls.length
    expect(initialCalls).toBeGreaterThan(0)

    extListeners.get('git-capability')?.({ type: 'session_workspace_changed', payload: { sessionId: 'welcome', op: 'bind' } })
    await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThan(initialCalls))
    const afterNotice = listSessions.mock.calls.length

    // Unrelated event types and unrelated channels must not trigger a refresh.
    extListeners.get('git-capability')?.({ type: 'extension_updated', payload: { extensionId: 'git-capability' } })
    extListeners.get('other-ext')?.({ type: 'session_workspace_changed', payload: { sessionId: 'welcome', op: 'bind' } })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(listSessions.mock.calls.length).toBe(afterNotice)
  })

  it('stays idle when the host has no ext subscription channel', async () => {
    const base = createMockHost()
    const listSessions = vi.spyOn(base, 'listSessions')
    render(<App host={base} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(listSessions.mock.calls.length).toBeGreaterThan(0)
  })
})
