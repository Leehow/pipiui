// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RemoteConnectionPanel,
  statusLabel,
  type PipiRemoteControlAPI,
  type RemoteControlState
} from './RemoteConnectionPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as Window & { pipiRemoteControl?: PipiRemoteControlAPI }).pipiRemoteControl
})

const PAIR = 'https://relay.example/pair/11111111-1111-4111-8111-111111111111#abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

function idle(over: Partial<RemoteControlState> = {}): RemoteControlState {
  return {
    enabled: false,
    status: 'idle',
    pairUrl: null,
    roomID: null,
    relayOrigin: null,
    hostEpoch: null,
    generation: null,
    ...over
  }
}

function mockApi(initial: RemoteControlState = idle()): PipiRemoteControlAPI & { calls: string[]; listeners: Array<(s: RemoteControlState) => void> } {
  let state = initial
  const listeners: Array<(s: RemoteControlState) => void> = []
  const calls: string[] = []
  const publish = (next: RemoteControlState) => {
    state = next
    for (const listener of listeners) listener(state)
    return state
  }
  return {
    calls,
    listeners,
    invoke: async command => {
      calls.push(command.type)
      return state
    },
    getState: async () => {
      calls.push('getState')
      return state
    },
    start: async () => {
      calls.push('start')
      return publish(idle({
        enabled: true,
        status: 'ready',
        pairUrl: PAIR,
        roomID: '11111111-1111-4111-8111-111111111111',
        relayOrigin: 'https://relay.example'
      }))
    },
    stop: async () => {
      calls.push('stop')
      return publish(idle({ status: 'stopped' }))
    },
    reset: async () => {
      calls.push('reset')
      return publish(idle({
        enabled: true,
        status: 'ready',
        pairUrl: `${PAIR}ff`,
        roomID: '22222222-2222-4222-8222-222222222222',
        relayOrigin: 'https://relay.example'
      }))
    },
    subscribe(listener) {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }
  }
}

describe('statusLabel', () => {
  it('maps remote-control statuses to Chinese copy', () => {
    expect(statusLabel('idle')).toBe('未开启')
    expect(statusLabel('stopped')).toBe('未开启')
    expect(statusLabel('connecting')).toBe('连接中')
    expect(statusLabel('ready')).toBe('已连接 Relay')
    expect(statusLabel('paired')).toBe('等待浏览器配对')
    expect(statusLabel('reconnecting')).toBe('断线重连中')
  })
})

describe('RemoteConnectionPanel', () => {
  it('degrades when IPC is missing', () => {
    render(<RemoteConnectionPanel onClose={() => undefined} />)
    expect(screen.getByText('当前连接未提供远程配对能力')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('renders switch, status, full pair url, and copy', async () => {
    const api = mockApi()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    const toggle = await screen.findByRole('switch', { name: '开启远程控制' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('remote-control-status').textContent).toBe('未开启')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(api.calls).toContain('start')
    expect(screen.getByTestId('remote-control-status').textContent).toBe('已连接 Relay')
    expect(screen.getByTestId('remote-pair-url').textContent).toBe(PAIR)
    expect(PAIR.includes('#abcdef')).toBe(true)
    expect(screen.getByTestId('remote-pair-qr').querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制配对链接' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PAIR))
  })

  it('confirms before reset', async () => {
    const api = mockApi(idle({
      enabled: true,
      status: 'ready',
      pairUrl: PAIR,
      roomID: '11111111-1111-4111-8111-111111111111',
      relayOrigin: 'https://relay.example'
    }))
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    await screen.findByRole('switch', { name: '开启远程控制' })
    fireEvent.click(screen.getByRole('button', { name: '重新生成链接' }))
    await waitFor(() => expect(api.calls).toContain('reset'))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByTestId('remote-pair-url').textContent?.endsWith('ff')).toBe(true)
  })

  it('skips reset when confirm is cancelled', async () => {
    const api = mockApi(idle({ enabled: true, status: 'ready', pairUrl: PAIR }))
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: '重新生成链接' }))
    expect(api.calls).not.toContain('reset')
  })

  it('applies subscribe push updates', async () => {
    const api = mockApi()
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    await screen.findByRole('switch')
    api.listeners[0]?.(idle({ enabled: true, status: 'reconnecting', pairUrl: PAIR }))
    await waitFor(() => expect(screen.getByTestId('remote-control-status').textContent).toBe('断线重连中'))
  })

  it('reads window.pipiRemoteControl when prop omitted', async () => {
    const api = mockApi()
    ;(window as Window & { pipiRemoteControl?: PipiRemoteControlAPI }).pipiRemoteControl = api
    render(<RemoteConnectionPanel onClose={() => undefined} />)
    expect(await screen.findByRole('switch', { name: '开启远程控制' })).toBeTruthy()
    expect(api.calls).toContain('getState')
  })
})
