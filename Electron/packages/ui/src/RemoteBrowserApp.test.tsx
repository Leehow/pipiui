// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  send = vi.fn()
  close = vi.fn()
  addEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
  }
  emit(type: string, value?: unknown) {
    this.listeners.get(type)?.forEach(listener => listener(value))
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

const pairID = '11111111-1111-4111-8111-111111111111'
const secret = 'ab'.repeat(32)

describe('RemoteBrowserApp', () => {
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
    sockets[0].emit('open')
    await waitFor(() => expect(document.querySelector('.pipiui-shell')).toBeTruthy())
    await waitFor(() => expect(sockets[0].send).toHaveBeenCalled())

    sockets[0].emit('close', { code: 1006, reason: '' })
    await waitFor(() => expect(sockets.length).toBeGreaterThan(1))
    expect(delays[0]).toBe(500)
    await waitFor(() => expect(screen.getByTestId('remote-lifecycle').getAttribute('data-phase')).toBe('reconnecting'))
    sockets[1].emit('open')
    await waitFor(() => expect(screen.queryByTestId('remote-lifecycle')).toBeNull())
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
})
