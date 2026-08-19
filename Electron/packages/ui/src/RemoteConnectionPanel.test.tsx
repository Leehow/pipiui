// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RELAY_ORIGIN,
  REMOTE_SELF_HOST_LESSON_DISMISSED,
  REMOTE_SELF_HOST_LESSON_KEY,
  REMOTE_SELF_HOST_PROMPT,
  RemoteConnectionPanel,
  statusLabel,
  type PipiRemoteControlAPI,
  type RemoteControlState
} from './RemoteConnectionPanel'
const computerUseCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'computer-use.css'), 'utf8')

function cssContract(selector: string, declaration: string): boolean {
  const idx = computerUseCss.indexOf(selector + '{')
  if (idx < 0) return false
  const end = computerUseCss.indexOf('}', idx)
  return computerUseCss.slice(idx, end).includes(declaration)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
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
    start: async (relayOrigin?: string) => {
      calls.push(relayOrigin ? `start:${relayOrigin}` : 'start')
      return publish(idle({
        enabled: true,
        status: 'ready',
        pairUrl: PAIR,
        roomID: '11111111-1111-4111-8111-111111111111',
        relayOrigin: relayOrigin ?? 'https://relay.example'
      }))
    },
    stop: async () => {
      calls.push('stop')
      return publish(idle({ status: 'stopped' }))
    },
    reset: async (relayOrigin?: string) => {
      calls.push(relayOrigin ? `reset:${relayOrigin}` : 'reset')
      return publish(idle({
        enabled: true,
        status: 'ready',
        pairUrl: `${PAIR}ff`,
        roomID: '22222222-2222-4222-8222-222222222222',
        relayOrigin: relayOrigin ?? 'https://relay.example'
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
    expect(api.calls.some(call => call === 'start' || call.startsWith('start:'))).toBe(true)
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

  it('does not auto-open the self-host lesson when localStorage is empty', async () => {
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={mockApi()} />)
    await screen.findByRole('switch')
    expect(screen.queryByTestId('remote-self-host-lesson')).toBeNull()
    expect(screen.getByRole('button', { name: '用自己的网站搭建' })).toBeTruthy()
  })

  it('dismisses the lesson and persists the flag', async () => {
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={mockApi()} />)
    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: '用自己的网站搭建' }))
    fireEvent.click(screen.getByRole('button', { name: '先用现在的服务器' }))
    expect(screen.queryByTestId('remote-self-host-lesson')).toBeNull()
    expect(localStorage.getItem(REMOTE_SELF_HOST_LESSON_KEY)).toBe(REMOTE_SELF_HOST_LESSON_DISMISSED)
  })

  it('asks PipiUI with the fixed prompt from the primary lesson button', async () => {
    const onAskPipiui = vi.fn()
    render(<RemoteConnectionPanel onClose={() => undefined} onAskPipiui={onAskPipiui} remoteControl={mockApi()} />)
    await screen.findByRole('switch')
    fireEvent.click(screen.getByRole('button', { name: '用自己的网站搭建' }))
    fireEvent.click(screen.getByRole('button', { name: '让 PipiUI 帮我搭建' }))
    expect(onAskPipiui).toHaveBeenCalledWith(REMOTE_SELF_HOST_PROMPT)
    expect(localStorage.getItem(REMOTE_SELF_HOST_LESSON_KEY)).toBe(REMOTE_SELF_HOST_LESSON_DISMISSED)
    expect(screen.queryByTestId('remote-self-host-lesson')).toBeNull()
  })

  it('places the pair QR before the pair URL when ready', async () => {
    const api = mockApi(idle({
      enabled: true,
      status: 'ready',
      pairUrl: PAIR,
      roomID: '11111111-1111-4111-8111-111111111111',
      relayOrigin: 'https://relay.example'
    }))
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    const qr = await screen.findByTestId('remote-pair-qr')
    const url = screen.getByTestId('remote-pair-url')
    expect(Boolean(qr.compareDocumentPosition(url) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('keeps the remote panel as a flex column with a scrollable body', () => {
    expect(cssContract('.remote-connection-panel', 'display:flex')).toBe(true)
    expect(cssContract('.remote-connection-panel', 'flex-direction:column')).toBe(true)
    expect(cssContract('.remote-connection-panel .settings-modal-body', 'overflow:auto')).toBe(true)
    expect(cssContract('.remote-connection-panel .settings-modal-body', 'flex:1')).toBe(true)
  })

  it('does not auto-open after dismiss, but reopen button shows the lesson again', async () => {
    localStorage.setItem(REMOTE_SELF_HOST_LESSON_KEY, REMOTE_SELF_HOST_LESSON_DISMISSED)
    const api = mockApi()
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    await screen.findByRole('switch')
    expect(screen.queryByTestId('remote-self-host-lesson')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '用自己的网站搭建' }))
    expect(screen.getByTestId('remote-self-host-lesson')).toBeTruthy()
  })

  it('applies a server origin via start when remote control is off', async () => {
    localStorage.setItem(REMOTE_SELF_HOST_LESSON_KEY, REMOTE_SELF_HOST_LESSON_DISMISSED)
    const api = mockApi()
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    await screen.findByRole('switch')
    const input = screen.getByTestId('remote-relay-origin') as HTMLInputElement
    expect(input.value).toBe(DEFAULT_RELAY_ORIGIN)
    fireEvent.change(input, { target: { value: 'https://mine.example' } })
    fireEvent.click(screen.getByRole('button', { name: '应用服务器地址' }))
    await waitFor(() => expect(api.calls).toContain('start:https://mine.example'))
  })

  it('confirms then resets when applying a new origin while enabled', async () => {
    localStorage.setItem(REMOTE_SELF_HOST_LESSON_KEY, REMOTE_SELF_HOST_LESSON_DISMISSED)
    const api = mockApi(idle({
      enabled: true,
      status: 'ready',
      pairUrl: PAIR,
      relayOrigin: 'https://relay.example'
    }))
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    await screen.findByRole('switch')
    const input = screen.getByTestId('remote-relay-origin') as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('https://relay.example'))
    fireEvent.change(input, { target: { value: 'https://mine.example' } })
    fireEvent.click(screen.getByRole('button', { name: '应用服务器地址' }))
    await waitFor(() => expect(api.calls).toContain('reset:https://mine.example'))
    expect(confirm).toHaveBeenCalled()
  })

  it('does not flash error when status jitters to error then reconnecting', async () => {
    const api = mockApi(idle({ enabled: true, status: 'ready', pairUrl: PAIR }))
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} hysteresisMs={20} />)
    await screen.findByRole('switch')
    expect(screen.getByTestId('remote-control-status').textContent).toBe('已连接 Relay')
    api.listeners[0]?.(idle({ enabled: true, status: 'error', pairUrl: PAIR, error: 'boom' }))
    expect(screen.getByTestId('remote-control-status').textContent).toBe('已连接 Relay')
    api.listeners[0]?.(idle({ enabled: true, status: 'reconnecting', pairUrl: PAIR }))
    expect(screen.getByTestId('remote-control-status').textContent).toBe('已连接 Relay')
    await waitFor(() => expect(screen.getByTestId('remote-control-status').textContent).toBe('断线重连中'))
    expect(screen.queryByText('出错')).toBeNull()
  })

  it('toggles local debug mode, shows the URL, and opens it', async () => {
    const api = mockApi()
    api.startDebug = async () => {
      api.calls.push('startDebug')
      const next = idle({ debugEnabled: true, debugUrl: 'http://127.0.0.1:4321/' })
      api.listeners.forEach(listener => listener(next))
      return next
    }
    api.stopDebug = async () => {
      api.calls.push('stopDebug')
      const next = idle({ debugEnabled: false, debugUrl: null })
      api.listeners.forEach(listener => listener(next))
      return next
    }
    const onOpenDebugUrl = vi.fn()
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} onOpenDebugUrl={onOpenDebugUrl} />)
    const toggle = await screen.findByRole('switch', { name: '本地 Debug 模式' })
    fireEvent.click(toggle)
    await waitFor(() => expect(api.calls).toContain('startDebug'))
    expect(onOpenDebugUrl).toHaveBeenCalledWith('http://127.0.0.1:4321/')
    expect(screen.getByTestId('remote-debug-url').textContent).toBe('http://127.0.0.1:4321/')
    fireEvent.click(screen.getByRole('button', { name: '打开本地界面' }))
    expect(onOpenDebugUrl).toHaveBeenCalledTimes(2)
    fireEvent.click(toggle)
    await waitFor(() => expect(api.calls).toContain('stopDebug'))
  })

  it('surfaces debug start errors', async () => {
    const api = mockApi()
    api.startDebug = async () => {
      api.calls.push('startDebug')
      return idle({ debugEnabled: false, debugError: '本地 Debug 静态目录不存在' })
    }
    api.stopDebug = async () => idle()
    render(<RemoteConnectionPanel onClose={() => undefined} remoteControl={api} />)
    fireEvent.click(await screen.findByRole('switch', { name: '本地 Debug 模式' }))
    await waitFor(() => expect(screen.getByTestId('remote-debug-error').textContent).toContain('静态目录'))
  })
})
