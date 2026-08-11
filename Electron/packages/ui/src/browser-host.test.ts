import { describe, expect, it, vi } from 'vitest'
import { createBrowserHost, safeExternalURL } from './browser-host'

class FakeSocket {
  readyState = 0
  listeners = new Map<string, Array<(...args: any[]) => void>>()
  send = vi.fn()
  close = vi.fn()
  addEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener() {}
  emit(type: string, value?: unknown) { this.listeners.get(type)?.forEach(listener => listener(value)) }
}

describe('browser Pi host selection', () => {
  it('connects the normal browser build to same-origin Host API without a mock fallback', async () => {
    const socket = new FakeSocket()
    const pending = createBrowserHost({
      location: { protocol: 'http:', host: 'localhost:5173' } as Location,
      open: vi.fn(() => ({} as Window)),
      socket: (url) => { expect(url).toBe('ws://localhost:5173/ws'); return socket as any },
    })
    socket.emit('open')
    const host = await pending
    const models = host.listModels()
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"method":"listModels"'))
    const request = JSON.parse(socket.send.mock.calls[0][0])
    socket.emit('message', { data: JSON.stringify({ protocolVersion: 2, id: request.id, type: 'response', ok: true, result: [{ provider: 'pi', id: 'live', name: 'Live', reasoning: true }] }) })
    await expect(models).resolves.toMatchObject([{ provider: 'pi', id: 'live' }])

    const providers = host.authProviders()
    const providerRequest = JSON.parse(socket.send.mock.calls[1][0])
    expect(providerRequest.method).toBe('authProviders')
    socket.emit('message', { data: JSON.stringify({ protocolVersion: 2, id: providerRequest.id, type: 'response', ok: true, result: [{ id: 'pi-provider', name: 'Pi Provider', authTypes: ['oauth'], authenticated: false }] }) })
    await expect(providers).resolves.toMatchObject([{ id: 'pi-provider', authTypes: ['oauth'] }])
  })

  it('fails clearly when Host API is unavailable', async () => {
    const socket = new FakeSocket()
    const pending = createBrowserHost({ location: { protocol: 'http:', host: 'localhost:5173' } as Location, socket: () => socket as any })
    socket.emit('error')
    await expect(pending).rejects.toThrow('无法连接本机 Pi Host')
  })

  it('opens only HTTP(S) OAuth URLs through the browser', () => {
    expect(safeExternalURL('https://login.example.test/path')).toBe('https://login.example.test/path')
    expect(() => safeExternalURL('javascript:alert(1)')).toThrow('HTTP(S)')
    expect(() => safeExternalURL('file:///tmp/secret')).toThrow('HTTP(S)')
  })
})
