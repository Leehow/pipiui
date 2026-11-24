// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    buffer = { active: { viewportY: 0, baseY: 0 } }
    options = {}
    open = vi.fn()
    write = vi.fn()
    clear = vi.fn()
    focus = vi.fn()
    scrollToBottom = vi.fn()
    loadAddon = vi.fn()
    dispose = vi.fn()
    onData() { return { dispose: vi.fn() } }
    onScroll() { return { dispose: vi.fn() } }
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { RemoteBrowserApp } from './RemoteBrowserApp'

class FakeSocket {
  readyState = 0
  listeners = new Map<string, Array<(...args: any[]) => void>>()
  send = vi.fn((data: string) => {
    const frame = JSON.parse(data)
    if (frame.method === 'capabilities') queueMicrotask(() => this.emit('message', {
      data: JSON.stringify({ protocolVersion: 2, type: 'response', id: frame.id, ok: true, result: {} })
    }))
  })
  close = vi.fn(() => {
    if (this.readyState >= 2) return
    this.emit('close', { code: 1000, reason: '' })
  })
  addEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
  }
  emit(type: string, value?: unknown) {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    this.listeners.get(type)?.forEach(listener => listener(value))
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const pairID = '11111111-1111-4111-8111-111111111111'
const secret = 'ab'.repeat(32)

describe('RemoteBrowserApp', () => {
  it('waits for a previously connected host to re-register after a relay restart', async () => {
    const sockets: FakeSocket[] = []
    const pending: Array<() => void> = []
    let claims = 0
    render(<RemoteBrowserApp
      location={{ protocol: 'https:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
      historyReplace={vi.fn()}
      fetch={async input => {
        if (!String(input).endsWith('/claim')) return new Response('', { status: 200 })
        claims += 1
        return new Response(null, { status: claims === 2 ? 403 : 204 })
      }}
      socket={() => { const socket = new FakeSocket(); sockets.push(socket); return socket as any }}
      schedule={fn => { pending.push(fn); return pending.length }} cancel={vi.fn()}
    />)
    await waitFor(() => expect(sockets).toHaveLength(1))
    await act(async () => { sockets[0].emit('open') })
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    await act(async () => { sockets[0].emit('close', { code: 1012 }); pending.shift()!() })
    await waitFor(() => expect(claims).toBe(2))
    expect(screen.queryByText('鉴权失败')).toBeNull()
    expect(pending).toHaveLength(1)
    await act(async () => { pending.shift()!() })
    await waitFor(() => expect(sockets).toHaveLength(2))
    await act(async () => { sockets[1].emit('open') })
    await waitFor(() => expect(screen.queryByTestId('remote-lifecycle')).toBeNull())
  })

  it('waits for a real host handshake, then recovers without replaying mutations', async () => {
    const sockets: FakeSocket[] = []
    const pending: Array<() => void> = []
    render(<RemoteBrowserApp
      location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
      connectionTimeoutMs={30}
      socket={() => {
        const socket = new FakeSocket()
        if (!sockets.length) socket.send.mockImplementation(() => {})
        sockets.push(socket)
        return socket as any
      }}
      schedule={fn => { pending.push(fn); return pending.length }} cancel={vi.fn()}
    />)
    await act(async () => { sockets[0].emit('open') })
    expect(document.querySelector('.pipiui-shell')).toBeNull()
    await waitFor(() => expect(sockets[0].close).toHaveBeenCalled())
    await act(async () => { pending.pop()!() })
    await act(async () => { sockets[1].emit('open') })
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    expect(sockets.flatMap(socket => socket.send.mock.calls.map(([data]) => JSON.parse(data).method)))
      .not.toContain('sendPrompt')
  })

  it('times out a hung claim as a recoverable failure', async () => {
    const pending: Array<() => void> = []
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    render(<RemoteBrowserApp
      location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
      fetch={fetchImpl as typeof fetch} connectionTimeoutMs={20}
      schedule={fn => { pending.push(fn); return pending.length }} cancel={vi.fn()}
    />)
    await waitFor(() => expect(pending).toHaveLength(1))
    expect(screen.queryByText('鉴权失败')).toBeNull()
    expect((fetchImpl.mock.calls as unknown as Array<[unknown, RequestInit]>)[0][1].signal?.aborted).toBe(true)
  })

  it('ignores stale StrictMode setup before it can claim a room', async () => {
    const pendingReads: Array<() => void> = []
    const sockets: FakeSocket[] = []
    const fetchImpl = vi.fn((input: RequestInfo | URL) => String(input).endsWith('/claim')
      ? Promise.resolve(new Response(null, { status: 204 }))
      : new Promise<Response>(resolve => pendingReads.push(() => resolve(new Response('', { status: 200 })))))
    render(<StrictMode><RemoteBrowserApp
      location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
      historyReplace={vi.fn()} fetch={fetchImpl as typeof fetch}
      socket={() => { const socket = new FakeSocket(); sockets.push(socket); return socket as any }}
    /></StrictMode>)
    await act(async () => { pendingReads.forEach(resolve => resolve()) })
    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/claim'))).toHaveLength(1)
  })

  it('retires a silent open socket and keeps the same App mounted during recovery', async () => {
    const sockets: FakeSocket[] = []
    let time = 100
    render(<RemoteBrowserApp
      location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
      now={() => time} pingIntervalMs={10} heartbeatTimeoutMs={40} hysteresisMs={1}
      socket={() => { const socket = new FakeSocket(); sockets.push(socket); return socket as any }}
      schedule={() => 1} cancel={vi.fn()}
    />)
    await act(async () => { sockets[0].emit('open') })
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    const shell = document.querySelector('.pipiui-shell')
    time += 41
    await waitFor(() => expect(screen.getByText('正在重新连接…')).toBeTruthy())
    expect(sockets[0].close).toHaveBeenCalled()
    expect(document.querySelector('.pipiui-shell')).toBe(shell)
  })

  it('does not take over another browser merely because this page returns to foreground', async () => {
    const socket = new FakeSocket()
    const schedule = vi.fn(() => 1)
    render(<RemoteBrowserApp
      location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
      socket={() => socket as any} schedule={schedule} cancel={vi.fn()}
    />)
    await act(async () => { socket.emit('open') })
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    await act(async () => {
      socket.emit('close', { code: 4001, reason: 'replaced' })
      window.dispatchEvent(new Event('pageshow'))
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.getByText('已在别处打开')).toBeTruthy()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('keeps one connection attempt when pageshow arrives during pairing', async () => {
    let finishClaim!: () => void
    const claim = new Promise<Response>(resolve => {
      finishClaim = () => resolve(new Response(null, { status: 204 }))
    })
    const sockets: FakeSocket[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/claim') ? claim : new Response('', { status: 200 }))
    const scheduled: Array<() => void> = []
    render(<RemoteBrowserApp
      location={{ protocol: 'https:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
      historyReplace={vi.fn()}
      fetch={fetchImpl as typeof fetch}
      socket={() => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as any
      }}
      schedule={fn => { scheduled.push(fn); return scheduled.length }}
      cancel={vi.fn()}
    />)
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'))
      document.dispatchEvent(new Event('visibilitychange'))
      scheduled.splice(0).forEach(fn => fn())
      finishClaim()
    })
    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await act(async () => { sockets[0].emit('open') })
    await waitFor(() => expect(sockets[0].send).toHaveBeenCalled())
    expect(sockets[0].close).not.toHaveBeenCalled()
  })

  it('pairs then connects, reconnects after a transient drop, and does not replay mutations', async () => {
    const sockets: FakeSocket[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith(`/pair/${pairID}`) && !url.endsWith('/claim')) return new Response('', { status: 200 })
      if (url.endsWith(`/pair/${pairID}/claim`)) {
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(JSON.stringify({ secret }))
        return new Response(null, { status: 204 })
      }
      throw new Error(url)
    })
    const delays: number[] = []
    const historyReplace = vi.fn()
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
        historyReplace={historyReplace}
        fetch={fetchImpl as unknown as typeof fetch}
        socket={() => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket as any
        }}
        schedule={(fn, ms) => {
          delays.push(ms)
          fn()
          return 1
        }}
        cancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('remote-lifecycle').getAttribute('data-phase')).toBe('connecting'))
    expect(fetchImpl).toHaveBeenCalled()
    expect(historyReplace).toHaveBeenCalledWith(`/pair/${pairID}#${secret}`)
    expect(historyReplace).not.toHaveBeenCalledWith('/')
    sockets[0].emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    await waitFor(() => expect(sockets[0].send).toHaveBeenCalled())

    sockets[0].emit('close', { code: 1006, reason: '' })
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1))
    expect(delays[0]).toBeGreaterThanOrEqual(500)
    expect(delays[0]).toBeLessThanOrEqual(750)
    expect(screen.queryByTestId('remote-lifecycle')).toBeNull()
    sockets[1].emit('open')
    await waitFor(() => expect(screen.queryByTestId('remote-lifecycle')).toBeNull())
    sockets[1].emit('close', { code: 1006, reason: '' })
    await waitFor(() => expect(sockets.length).toBeGreaterThan(2))
    expect(delays[1]).toBeGreaterThanOrEqual(500)
    expect(delays[1]).toBeLessThanOrEqual(750)
    const methods = sockets[1].send.mock.calls.map(call => {
      try { return JSON.parse(String(call[0])).method } catch { return undefined }
    })
    expect(methods).not.toContain('sendPrompt')
    expect(methods).not.toContain('newSession')
  })

  it('shows replaced and expired copy without auto-reconnect', async () => {
    const socket = new FakeSocket()
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
        socket={() => socket as any}
        schedule={() => 1}
        cancel={vi.fn()}
      />,
    )
    socket.emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    socket.emit('message', { data: JSON.stringify({ v: 2, type: 'replaced' }) })
    socket.emit('close', { code: 4001, reason: 'replaced' })
    await waitFor(() => expect(screen.getByText('已在别处打开')).toBeTruthy())
    expect(screen.getByRole('button', { name: '重新接管' })).toBeTruthy()
    expect(screen.getByText(/另一浏览器/)).toBeTruthy()
    cleanup()

    const expired = new FakeSocket()
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
        socket={() => expired as any}
        schedule={() => { throw new Error('should not reconnect') }}
        cancel={vi.fn()}
      />,
    )
    expired.emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    expired.emit('close', { code: 1000, reason: 'link expired' })
    await waitFor(() => expect(screen.getByText('房间已过期')).toBeTruthy())
  })

  it('auto re-claims after a transient auth drop when pair is stored', async () => {
    const sockets: FakeSocket[] = []
    let claims = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith(`/pair/${pairID}`) && !url.endsWith('/claim')) return new Response('', { status: 200 })
      if (url.endsWith(`/pair/${pairID}/claim`)) {
        claims += 1
        expect(init?.method).toBe('POST')
        return new Response(null, { status: 204 })
      }
      throw new Error(url)
    })
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
        historyReplace={vi.fn()}
        fetch={fetchImpl as unknown as typeof fetch}
        socket={() => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket as any
        }}
        schedule={(fn) => {
          fn()
          return 1
        }}
        cancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0].emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    expect(claims).toBe(1)
    expect(sessionStorage.getItem('pipiui:remote-pair')).toContain(pairID)

    sockets[0].emit('close', { code: 1006, reason: '401 pairing required' })
    await waitFor(() => expect(claims).toBe(2))
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1))
    sockets[sockets.length - 1].emit('open')
    await waitFor(() => expect(screen.queryByTestId('remote-lifecycle')).toBeNull())
  })

  it('does not auto re-claim after replaced and offers 重新接管', async () => {
    const sockets: FakeSocket[] = []
    let claims = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/claim')) {
        claims += 1
        return new Response(null, { status: 204 })
      }
      if (url.includes(`/pair/${pairID}`)) return new Response('', { status: 200 })
      throw new Error(url)
    })
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
        historyReplace={vi.fn()}
        fetch={fetchImpl as unknown as typeof fetch}
        socket={() => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket as any
        }}
        schedule={() => {
          throw new Error('should not auto-reconnect after replaced')
        }}
        cancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0].emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    expect(claims).toBe(1)
    sockets[0].emit('message', { data: JSON.stringify({ v: 2, type: 'replaced' }) })
    sockets[0].emit('close', { code: 4001, reason: 'replaced' })
    await waitFor(() => expect(screen.getByText('已在别处打开')).toBeTruthy())
    expect(screen.getByRole('button', { name: '重新接管' })).toBeTruthy()
    expect(claims).toBe(1)
    expect(sockets.length).toBe(1)
  })

  it('shows expired copy when reclaim returns 404', async () => {
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
        fetch={async (input: RequestInfo | URL) => {
          const url = String(input)
          if (url.endsWith('/claim')) return new Response('', { status: 404 }) as any
          return new Response('', { status: 200 }) as any
        }}
        socket={() => new FakeSocket() as any}
      />,
    )
    await waitFor(() => expect(screen.getByText('房间已过期')).toBeTruthy())
    expect(screen.getByText(/链接已被吊销/)).toBeTruthy()
  })

  it('surfaces pairing auth failure', async () => {
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: `/pair/${pairID}`, hash: `#${secret}` }}
        fetch={async () => new Response(JSON.stringify({ error: 'pairing rejected' }), { status: 403 }) as any}
        socket={() => new FakeSocket() as any}
      />,
    )
    await waitFor(() => expect(screen.getByText('鉴权失败')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重试连接' }))
    await waitFor(() => expect(screen.getByText('鉴权失败')).toBeTruthy())
  })

  it('closes the previous socket before reclaim and reconnect', async () => {
    const sockets: FakeSocket[] = []
    sessionStorage.setItem('pipiui:remote-pair', JSON.stringify({ pairID, secret }))
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/claim')) return new Response(null, { status: 204 })
      if (url.includes(`/pair/${pairID}`)) return new Response('', { status: 200 })
      throw new Error(url)
    })
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
        fetch={fetchImpl as unknown as typeof fetch}
        socket={() => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket as any
        }}
        schedule={(fn) => {
          fn()
          return 1
        }}
        cancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0].emit('error', { code: 1006, reason: '401 pairing required' })
    sockets[0].emit('close', { code: 1006, reason: '401 pairing required' })
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1))
    expect(sockets[0].close).toHaveBeenCalled()
    expect(sockets.filter(item => item.close.mock.calls.length === 0).length).toBeLessThanOrEqual(1)
  })

  it('holds reconnecting banner for hysteresis then shows it', async () => {
    const sockets: FakeSocket[] = []
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
        hysteresisMs={20}
        socket={() => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket as any
        }}
        schedule={() => 1}
        cancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0].emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    sockets[0].emit('close', { code: 1006, reason: '' })
    expect(screen.queryByTestId('remote-lifecycle')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('remote-lifecycle').getAttribute('data-phase')).toBe('reconnecting'))
    expect(screen.getByText('正在重新连接…')).toBeTruthy()
  })

  it('reconnects immediately on visibilitychange when not connected', async () => {
    const sockets: FakeSocket[] = []
    const pending: Array<() => void> = []
    render(
      <RemoteBrowserApp
        location={{ protocol: 'http:', host: 'relay.test', pathname: '/', hash: '' }}
        socket={() => {
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket as any
        }}
        schedule={(fn) => {
          pending.push(fn)
          return pending.length
        }}
        cancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0].emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    sockets[0].emit('close', { code: 1006, reason: '' })
    expect(pending.length).toBeGreaterThan(0)
    const before = sockets.length
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    pending[pending.length - 1]()
    await waitFor(() => expect(sockets.length).toBeGreaterThan(before))
    expect(sockets[0].close).toHaveBeenCalled()
  })
})
