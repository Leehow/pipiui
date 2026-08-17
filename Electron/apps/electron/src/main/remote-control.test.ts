import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { HostBackend, HostEvent } from '@pipi/host-api'
import { createHostAPIRelay } from '../../../../../Relay/src/host-api-relay.js'
import {
  createRemoteControlService,
  pairUrlFor,
  registerRemoteControlIpc,
  REMOTE_CONTROL_STORE_FILE,
  withRemoteSessionCapabilities,
  type RemoteControlCommand,
  type RemoteControlState
} from './remote-control.js'

const PAIR_COOKIE = 'pipiui_pair'

type FrameQueue = {
  values: string[]
  waiters: Array<(value: string) => void>
}

function installQueue(socket: WebSocket): FrameQueue {
  const queue: FrameQueue = { values: [], waiters: [] }
  socket.addEventListener('message', event => {
    const text = String(event.data)
    const waiter = queue.waiters.shift()
    if (waiter) waiter(text)
    else queue.values.push(text)
  })
  return queue
}

async function nextRaw(queue: FrameQueue, socket: WebSocket, timeoutMs = 4_000): Promise<string> {
  const queued = queue.values.shift()
  if (queued !== undefined) return queued
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('frame timeout')), timeoutMs)
    const onClose = () => {
      clearTimeout(timer)
      reject(new Error('socket closed'))
    }
    socket.addEventListener('close', onClose, { once: true })
    queue.waiters.push(text => {
      clearTimeout(timer)
      socket.removeEventListener('close', onClose)
      resolve(text)
    })
  })
}

async function nextFrame(queue: FrameQueue, socket: WebSocket): Promise<Record<string, unknown>> {
  return JSON.parse(await nextRaw(queue, socket)) as Record<string, unknown>
}

async function nextBusinessFrame(queue: FrameQueue, socket: WebSocket): Promise<Record<string, unknown>> {
  for (;;) {
    const frame = await nextFrame(queue, socket)
    if (frame.v === 2) continue
    return frame
  }
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 4_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(message)
}

async function startRelay() {
  const relay = createHostAPIRelay({
    publicOrigin: 'http://127.0.0.1',
    browserUIDir: join(tmpdir(), 'pipiui-missing-browser-ui')
  })
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!relay.handleRequest(req, res, url)) {
      res.statusCode = 404
      res.end()
    }
  })
  server.on('upgrade', (req, socket, head) => {
    if (!relay.handleUpgrade(req, socket, head)) socket.destroy()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    async close() {
      await relay.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
}

function cookieHeader(setCookie: string | null): string {
  const match = setCookie ? new RegExp(`${PAIR_COOKIE}=([^;]+)`).exec(setCookie) : null
  if (!match) throw new Error('missing pair cookie')
  return `${PAIR_COOKIE}=${match[1]}`
}

async function claim(origin: string, roomID: string, secret: string): Promise<Response> {
  return fetch(`${origin}/pair/${roomID}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret })
  })
}

function mockBackend(handle = vi.fn(async (method: string) => {
  if (method === 'capabilities') {
    return { computerUse: true, terminal: true, browser: true, revealInFinder: true, plan: false, retainedWorktreeDisposition: false }
  }
  if (method === 'listProjects') return [{ id: 'p1', name: 'Demo', path: '/tmp/demo' }]
  return null
})) {
  const listeners = new Set<(event: HostEvent) => void>()
  const backend = {
    handle,
    closed: false,
    subscribe(listener: (event: HostEvent) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async close() {
      backend.closed = true
    },
    emit(event: HostEvent) {
      for (const listener of listeners) listener(event)
    }
  }
  return backend
}

describe('withRemoteSessionCapabilities', () => {
  it('forces remote-unsafe capabilities off', async () => {
    const backend = mockBackend()
    const wrapped = withRemoteSessionCapabilities(backend)
    await expect(wrapped.handle('capabilities', [])).resolves.toMatchObject({
      computerUse: false,
      terminal: false,
      browser: false,
      revealInFinder: false
    })
  })
})

describe('createRemoteControlService', () => {
  const temps: string[] = []
  const relays: Array<{ close(): Promise<void> }> = []
  const services: Array<{ stop(): Promise<RemoteControlState> }> = []

  afterEach(async () => {
    for (const service of services.splice(0)) await service.stop().catch(() => undefined)
    for (const relay of relays.splice(0)) await relay.close().catch(() => undefined)
    for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function userData(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'pipi-remote-control-'))
    temps.push(dir)
    return dir
  }

  it('pairs, forwards request/response/event, replaces the second browser, and reconnects the same room', async () => {
    const relay = await startRelay()
    relays.push(relay)
    const dir = await userData()
    const backend = mockBackend()
    const service = createRemoteControlService({
      backend,
      userDataDir: dir,
      relayOrigin: relay.origin,
      backoffMs: () => 50,
      pingIntervalMs: 200,
      connect: url => new WebSocket(url) as unknown as WebSocket
    })
    services.push(service)

    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const firstRoom = service.getState().roomID
    expect(firstRoom).toMatch(/^[0-9a-f-]{36}$/)
    const persisted = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')) as {
      pairSecret: string
      roomID: string
      enabled: boolean
    }
    expect(persisted.enabled).toBe(true)
    expect(persisted.roomID).toBe(firstRoom)
    expect(service.getState().pairUrl).toBe(pairUrlFor(relay.origin, persisted.roomID, persisted.pairSecret))

    const granted = await claim(relay.origin, persisted.roomID, persisted.pairSecret)
    expect(granted.status).toBe(204)
    const browser = new WebSocket(`ws://127.0.0.1:${new URL(relay.origin).port}/ws`, {
      headers: { Cookie: cookieHeader(granted.headers.get('set-cookie')) }
    } as never)
    const browserQ = installQueue(browser)
    await new Promise((resolve, reject) => {
      browser.addEventListener('open', resolve, { once: true })
      browser.addEventListener('error', () => reject(new Error('browser ws')), { once: true })
    })
    await waitFor(() => service.getState().status === 'paired', 'host never paired')

    browser.send(JSON.stringify({
      protocolVersion: 2,
      id: 'req-1',
      type: 'request',
      method: 'listProjects',
      params: []
    }))
    const response = await nextBusinessFrame(browserQ, browser)
    expect(response).toMatchObject({ type: 'response', id: 'req-1', ok: true, result: [{ id: 'p1' }] })

    backend.emit({ protocolVersion: 2, channel: 'stream', event: { type: 'status', sessionId: 's', status: 'started' } })
    const event = await nextBusinessFrame(browserQ, browser)
    expect(event).toMatchObject({ type: 'event', channel: 'stream' })

    browser.send(JSON.stringify({ protocolVersion: 2, id: 'cap', type: 'request', method: 'capabilities', params: [] }))
    const caps = await nextBusinessFrame(browserQ, browser)
    expect(caps).toMatchObject({
      type: 'response',
      ok: true,
      result: { computerUse: false, terminal: false, browser: false, revealInFinder: false }
    })

    const granted2 = await claim(relay.origin, persisted.roomID, persisted.pairSecret)
    const second = new WebSocket(`ws://127.0.0.1:${new URL(relay.origin).port}/ws`, {
      headers: { Cookie: cookieHeader(granted2.headers.get('set-cookie')) }
    } as never)
    const secondQ = installQueue(second)
    await new Promise((resolve, reject) => {
      second.addEventListener('open', resolve, { once: true })
      second.addEventListener('error', () => reject(new Error('second browser')), { once: true })
    })
    if (browser.readyState !== WebSocket.CLOSED && browser.readyState !== WebSocket.CLOSING) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('first browser not replaced')), 4_000)
        browser.addEventListener('close', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
    second.send(JSON.stringify({
      protocolVersion: 2,
      id: 'req-2',
      type: 'request',
      method: 'listProjects',
      params: []
    }))
    const secondResponse = await nextBusinessFrame(secondQ, second)
    expect(secondResponse).toMatchObject({ type: 'response', id: 'req-2', ok: true })

    service.dropConnection()
    await waitFor(
      () => service.getState().status === 'reconnecting' || service.getState().status === 'paired' || service.getState().status === 'ready',
      'did not start reconnect'
    )
    await waitFor(
      () => service.getState().status === 'ready' || service.getState().status === 'paired',
      'did not rejoin room'
    )
    expect(service.getState().roomID).toBe(firstRoom)

    second.close()
    browser.close()
  }, 15_000)

  it('does not close the shared backend when the remote socket drops', async () => {
    const relay = await startRelay()
    relays.push(relay)
    const dir = await userData()
    const backend = mockBackend()
    const service = createRemoteControlService({
      backend,
      userDataDir: dir,
      relayOrigin: relay.origin,
      backoffMs: () => 30
    })
    services.push(service)
    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    service.dropConnection()
    await waitFor(() => service.getState().status === 'reconnecting' || service.getState().status === 'ready', 'no reconnect')
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(backend.closed).toBe(false)
  })

  it('restores an enabled room from userData and reset mints a new secret', async () => {
    const relay = await startRelay()
    relays.push(relay)
    const dir = await userData()
    const first = createRemoteControlService({ backend: mockBackend(), userDataDir: dir, relayOrigin: relay.origin })
    services.push(first)
    await first.start()
    await waitFor(() => first.getState().status === 'ready', 'first host ready')
    const roomA = first.getState().roomID
    const secretA = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')).pairSecret as string
    await first.stop()

    const restarted = createRemoteControlService({ backend: mockBackend(), userDataDir: dir, relayOrigin: relay.origin })
    services.push(restarted)
    const restored = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8'))
    expect(restored.roomID).toBe(roomA)
    expect(restored.enabled).toBe(false)
    await restarted.restore()
    expect(restarted.getState().roomID).toBe(roomA)
    expect(restarted.getState().status).toBe('idle')

    await restarted.start()
    await waitFor(() => restarted.getState().status === 'ready', 'restored host ready')
    expect(restarted.getState().roomID).toBe(roomA)

    await restarted.reset()
    await waitFor(() => restarted.getState().roomID !== roomA, 'reset kept room')
    const after = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8'))
    expect(after.pairSecret).not.toBe(secretA)
    expect(after.roomID).not.toBe(roomA)
  })

  it('pushes state over the IPC event channel', async () => {
    const sent: RemoteControlState[] = []
    const sender = { send: (_channel: string, state: RemoteControlState) => { sent.push(state) } }
    let handler: ((event: { sender: typeof sender }, command: RemoteControlCommand) => Promise<RemoteControlState>) | undefined
    const ipc = {
      handle(_channel: string, listener: typeof handler) {
        handler = listener
      }
    }
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: await userData(),
      relayOrigin: 'http://127.0.0.1:9'
    })
    services.push(service)
    registerRemoteControlIpc(ipc as never, service)
    await handler?.({ sender }, { type: 'getState' })
    await handler?.({ sender }, { type: 'stop' })
    expect(sent.some(item => item.status === 'stopped')).toBe(true)
  })
})
