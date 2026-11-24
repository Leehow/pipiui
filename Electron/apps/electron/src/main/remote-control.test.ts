import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { createWsHost, type HostBackend, type HostEvent } from '@pipi/host-api'
import { createHostAPIRelay } from '../../../../../Relay/src/host-api-relay.js'
import {
  bindRemoteControlPowerLifecycle,
  bindRemoteControlSleepPrevention,
  createRemoteControlService,
  pairUrlFor,
  probeRemotePairLink,
  registerRemoteControlIpc,
  REMOTE_CONTROL_STORE_FILE,
  withRemoteSessionCapabilities,
  type RemoteControlCommand,
  type RemoteControlState,
  type RemoteControlStored
} from './remote-control.js'
import { createRemoteDebugService } from './remote-debug.js'

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

async function startRelay(options: { browserUIDir?: string; ttlMs?: number } = {}) {
  const relay = createHostAPIRelay({
    publicOrigin: 'http://127.0.0.1',
    browserUIDir: options.browserUIDir ?? join(tmpdir(), 'pipiui-missing-browser-ui'),
    ttlMs: options.ttlMs
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
    roomCount: () => relay.getRoomCount(),
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

type FakeSocket = {
  readyState: number
  sent: string[]
  on(type: string, listener: (...args: any[]) => void): void
  off(type: string, listener: (...args: any[]) => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
  fireOpen(): void
  fireMessage(text: string): void
}

function makeFakeSocket(): FakeSocket {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const emit = (type: string, ...args: unknown[]) => {
    for (const listener of listeners.get(type) ?? []) listener(...args)
  }
  const socket: FakeSocket = {
    readyState: 0,
    sent: [],
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    send(data) {
      socket.sent.push(data)
    },
    close() {
      if (socket.readyState >= 2) return
      socket.readyState = 3
      emit('close')
    },
    fireOpen() {
      socket.readyState = 1
      emit('open')
    },
    fireMessage(text) {
      emit('message', text)
    }
  }
  return socket
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

  it('pages growing agent data through the real relay and isolates an oversized response', async () => {
    const relay = await startRelay()
    relays.push(relay)
    const rows = Array.from({ length: 180 }, (_, i) => ({
      sessionId: 'session', agentId: `agent-${String(i).padStart(3, '0')}`, runId: 'run',
      name: 'worker', task: 'full task', state: 'ok', finalResult: 'x'.repeat(96 * 1024)
    }))
    const backend = mockBackend(vi.fn(async method => {
      if (method === 'listAgents') return rows
      if (method === 'getAgentLogs') return 'x'.repeat(9 * 1024 * 1024)
      if (method === 'capabilities') return {}
      if (method === 'listProjects') return [{ id: 'project' }]
      return null
    }) as any)
    const dir = await userData()
    const service = createRemoteControlService({ backend, userDataDir: dir, relayOrigin: relay.origin })
    services.push(service)
    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host not ready')
    const stored = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8'))
    const grant = await claim(relay.origin, stored.roomID, stored.pairSecret)
    const socket = new WebSocket(relay.origin.replace('http:', 'ws:') + '/ws', {
      headers: { Cookie: cookieHeader(grant.headers.get('set-cookie')) }
    })
    await new Promise<void>(resolve => socket.once('open', resolve))
    let largestFrame = 0
    socket.on('message', data => { largestFrame = Math.max(largestFrame, data.toString().length) })
    const host = createWsHost(socket)
    try {
      const received = await host.listAgents()
      expect(received.map(row => row.agentId)).toEqual(rows.map(row => row.agentId))
      expect(received.every(row => row.finalResult === rows[0].finalResult && row.task === 'full task')).toBe(true)
      expect(largestFrame).toBeLessThan(1024 * 1024)
      await expect(host.getAgentLogs('agent', 'session', 'run')).rejects.toMatchObject({ code: 'response_too_large' })
      await expect(host.listProjects()).resolves.toEqual([{ id: 'project' }])
      expect(socket.readyState).toBe(WebSocket.OPEN)
      expect(backend.closed).toBe(false)
    } finally { socket.close() }
  })

  it('retires silent handshakes and half-open sockets without rotating identity or overlapping starts', async () => {
    const sockets: FakeSocket[] = []
    let time = 100
    const service = createRemoteControlService({
      backend: mockBackend(), userDataDir: await userData(), relayOrigin: 'http://relay.test',
      now: () => time, connectionTimeoutMs: 40, heartbeatTimeoutMs: 100, pingIntervalMs: 10,
      backoffMs: () => 1,
      connect: () => { const socket = makeFakeSocket(); sockets.push(socket); return socket }
    })
    services.push(service)
    await service.start()
    const room = service.getState().roomID
    await service.start()
    expect(sockets).toHaveLength(1)
    // Even if close never emits, the handshake watchdog must release the loop.
    sockets[0].close = () => { sockets[0].readyState = 2 }
    await waitFor(() => sockets.length === 2, 'handshake did not time out')
    sockets[1].fireOpen()
    sockets[1].fireMessage(JSON.stringify({ v: 2, type: 'ready', hostEpoch: 1 }))
    time += 101
    await waitFor(() => sockets.length >= 3, 'silent connection not retired')
    expect(service.getState().roomID).toBe(room)
  })

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

    browser.send(JSON.stringify({
      protocolVersion: 2,
      id: 'project-events',
      type: 'request',
      method: 'setEventProjectionSession',
      params: ['selected']
    }))
    await expect(nextBusinessFrame(browserQ, browser)).resolves.toMatchObject({
      type: 'response',
      id: 'project-events',
      ok: true
    })
    backend.emit({ protocolVersion: 2, channel: 'stream', event: { type: 'text', sessionId: 'background', contentIndex: 0, delta: 'drop before relay' } })
    backend.emit({ protocolVersion: 2, channel: 'stream', event: { type: 'text', sessionId: 'selected', contentIndex: 0, delta: 'keep selected' } })
    await expect(nextBusinessFrame(browserQ, browser)).resolves.toMatchObject({
      type: 'event',
      channel: 'stream',
      event: { type: 'text', sessionId: 'selected', delta: 'keep selected' }
    })

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

  it('serves the authenticated browser UI, upgrades /ws, and keeps the pair identity across an attached TTL firing and a hostless expiry', async () => {
    const dir = await userData()
    const ui = join(dir, 'browser-ui')
    await mkdir(join(ui, 'assets'), { recursive: true })
    await writeFile(
      join(ui, 'index.html'),
      '<!doctype html><main data-browser-ui="remote-e2e"></main><script src="/assets/app.js"></script>',
      'utf8'
    )
    await writeFile(join(ui, 'assets/app.js'), 'window.__PIPIUI_REMOTE_UI__=true;', 'utf8')
    const relay = await startRelay({ browserUIDir: ui, ttlMs: 400 })
    relays.push(relay)
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: relay.origin,
      // After a drop, stay offline past one TTL firing so the hostless room
      // really expires before the next hello.
      backoffMs: (attempt: number) => (attempt === 0 ? 600 : 10),
      pingIntervalMs: 100,
      connect: url => new WebSocket(url) as unknown as WebSocket
    })
    services.push(service)

    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const expiredRoom = service.getState().roomID
    const expiredUrl = service.getState().pairUrl
    expect(expiredRoom).toBeTruthy()
    expect(expiredUrl).toBeTruthy()
    const before = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')) as RemoteControlStored

    const granted = await claim(relay.origin, before.roomID, before.pairSecret)
    expect(granted.status).toBe(204)
    const cookie = cookieHeader(granted.headers.get('set-cookie'))
    const page = await fetch(`${relay.origin}/pair/${before.roomID}`, { headers: { Cookie: cookie } })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('data-browser-ui="remote-e2e"')
    const asset = await fetch(`${relay.origin}/assets/app.js`, { headers: { Cookie: cookie } })
    expect(asset.status).toBe(200)
    expect(await asset.text()).toBe('window.__PIPIUI_REMOTE_UI__=true;')

    const browser = new WebSocket(`ws://127.0.0.1:${new URL(relay.origin).port}/ws`, {
      headers: { Cookie: cookie }
    } as never)
    const browserQ = installQueue(browser)
    await new Promise((resolve, reject) => {
      browser.addEventListener('open', resolve, { once: true })
      browser.addEventListener('error', () => reject(new Error('browser ws')), { once: true })
    })
    browser.send(JSON.stringify({
      protocolVersion: 2,
      id: 'browser-tail',
      type: 'request',
      method: 'listProjects',
      params: []
    }))
    await expect(nextBusinessFrame(browserQ, browser)).resolves.toMatchObject({
      type: 'response',
      id: 'browser-tail',
      ok: true
    })

    // TTL re-arms while the host is attached: the room must survive several
    // TTL windows mid-session without rotating the identity.
    await new Promise(resolve => setTimeout(resolve, 1_000))
    expect(['ready', 'paired']).toContain(service.getState().status)
    expect(service.getState().roomID).toBe(expiredRoom)
    expect(relay.roomCount()).toBe(1)

    // Hostless expiry (drop, TTL fires with no host) must also keep the
    // identity: the next hello silently re-creates the same room.
    service.dropConnection()
    await waitFor(() => relay.roomCount() === 0, 'hostless room was never expired', 3_000)
    await waitFor(() => service.getState().status === 'ready', 'service did not reconnect after hostless expiry')
    expect(service.getState().roomID).toBe(expiredRoom)
    expect(service.getState().pairUrl).toBe(expiredUrl)
    expect(service.getState().rotationNotice).toBeFalsy()
    const after = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')) as RemoteControlStored
    expect(after.enabled).toBe(true)
    expect(after.roomID).toBe(before.roomID)
    expect(after.pairSecret).toBe(before.pairSecret)
    expect((await claim(relay.origin, before.roomID, before.pairSecret)).status).toBe(204)
    browser.close()
  }, 15_000)

  it('surfaces a rotation notice when the relay expires the room, and reset clears it', async () => {
    const dir = await userData()
    const sockets: FakeSocket[] = []
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: 'http://relay.test',
      backoffMs: () => 5,
      pingIntervalMs: 60_000,
      connect: () => {
        const socket = makeFakeSocket()
        sockets.push(socket)
        return socket
      }
    })
    services.push(service)

    await service.start()
    const first = sockets[0]
    expect(first).toBeTruthy()
    first.fireOpen()
    await waitFor(() => first.sent.some(text => text.includes('"hello"')), 'first hello not sent')
    first.fireMessage(JSON.stringify({ v: 2, type: 'ready', hostEpoch: 1, browserAttached: false }))
    await waitFor(() => service.getState().status === 'ready', 'never became ready')
    const originalRoom = service.getState().roomID
    const originalUrl = service.getState().pairUrl
    expect(originalRoom).toBeTruthy()

    first.fireMessage(JSON.stringify({ v: 2, type: 'expired' }))
    const secondHello = () => {
      const second = sockets[1]
      if (second && second.readyState === 0) second.fireOpen()
      return Boolean(second?.sent.some(text => {
        try { return (JSON.parse(text) as Record<string, unknown>).type === 'hello' } catch { return false }
      }))
    }
    await waitFor(secondHello, 'second hello not sent', 2_000)
    await waitFor(() => service.getState().roomID !== originalRoom, 'identity was not rotated')
    const second = sockets[1]
    expect(service.getState().rotationNotice).toBeTruthy()
    expect(service.getState().pairUrl).not.toBe(originalUrl)

    second.fireMessage(JSON.stringify({ v: 2, type: 'ready', hostEpoch: 1, browserAttached: false }))
    await waitFor(() => service.getState().status === 'ready', 'rotated room never became ready')
    expect(service.getState().rotationNotice).toBeTruthy()

    await service.reset()
    expect(service.getState().rotationNotice).toBeUndefined()
  })

  it('closes a stale host socket when power state requests a reconnect', async () => {
    const dir = await userData()
    const sockets: FakeSocket[] = []
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: 'http://relay.test',
      backoffMs: () => 5,
      connect: () => {
        const socket = makeFakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    services.push(service)

    await service.start()
    const first = sockets[0]
    first.fireOpen()
    await waitFor(() => first.sent.some(text => text.includes('"hello"')), 'hello not sent')
    service.requestReconnect()
    await waitFor(() => first.readyState === 3, 'stale socket was not closed')
  })

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

  it('exposes debug start/stop/state without relay tokens', async () => {
    const sent: RemoteControlState[] = []
    const sender = { send: (_channel: string, state: RemoteControlState) => { sent.push(state) } }
    let handler: ((event: { sender: typeof sender }, command: RemoteControlCommand) => Promise<RemoteControlState>) | undefined
    const ipc = {
      handle(_channel: string, listener: typeof handler) {
        handler = listener
      }
    }
    const dir = await userData()
    const ui = join(dir, 'ui')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(ui)
    await writeFile(join(ui, 'index.html'), '<!doctype html><title>d</title>', 'utf8')
    const debug = createRemoteDebugService({ backend: mockBackend(), staticDir: ui })
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: 'http://127.0.0.1:9'
    })
    services.push(service)
    registerRemoteControlIpc(ipc as never, service, 'pipi-remote-control:v1', 'pipi-remote-control:event', debug)
    const started = await handler?.({ sender }, { type: 'startDebug' })
    expect(started?.debugEnabled).toBe(true)
    expect(started?.debugUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(started?.enabled).toBe(false)
    expect(JSON.stringify(started)).not.toMatch(/hostToken|pairSecret/)
    expect(sent.some(item => item.debugEnabled)).toBe(true)
    const stopped = await handler?.({ sender }, { type: 'stopDebug' })
    expect(stopped?.debugEnabled).toBe(false)
    await debug.close()
  })
})

describe('remote pair link check', () => {
  const temps: string[] = []
  const relays: Array<{ close(): Promise<void> }> = []
  const services: Array<{ stop(): Promise<RemoteControlState> }> = []

  afterEach(async () => {
    for (const service of services.splice(0)) await service.stop().catch(() => undefined)
    for (const relay of relays.splice(0)) await relay.close().catch(() => undefined)
    for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function userData(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'pipi-remote-link-check-'))
    temps.push(dir)
    return dir
  }

  function connectWs(url: string) {
    return new WebSocket(url) as unknown as WebSocket
  }

  it('proves claim + browser ws + capabilities without flipping host to paired', async () => {
    const relay = await startRelay()
    relays.push(relay)
    const dir = await userData()
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: relay.origin,
      backoffMs: () => 50,
      connect: connectWs
    })
    services.push(service)
    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const checked = await service.checkLink()
    expect(checked.linkCheck?.status).toBe('ok')
    expect(checked.linkCheck?.pairUrl).toBe(service.getState().pairUrl)
    expect(service.getState().status).toBe('ready')
    const persisted = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')) as RemoteControlStored
    expect((await claim(relay.origin, persisted.roomID, persisted.pairSecret)).status).toBe(204)
  }, 15_000)

  it('fails when the relay origin is unreachable', async () => {
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: await userData(),
      relayOrigin: 'http://127.0.0.1:1',
      probeTimeoutMs: 400,
      backoffMs: () => 10_000,
      connect: connectWs
    })
    services.push(service)
    await service.start()
    const checked = await service.checkLink()
    expect(checked.linkCheck?.status).toBe('failed')
    expect(checked.linkCheck?.reason).toMatch(/超时|不可达/)
  })

  it('reports expired or wrong secret without consuming the real pair grant', async () => {
    const relay = await startRelay({ ttlMs: 700 })
    relays.push(relay)
    const dir = await userData()
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: relay.origin,
      backoffMs: () => 30,
      connect: connectWs
    })
    services.push(service)
    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const live = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')) as RemoteControlStored

    const wrong = await probeRemotePairLink({
      origin: relay.origin,
      roomID: live.roomID,
      pairSecret: 'ab'.repeat(32)
    })
    expect(wrong).toEqual({ ok: false, reason: '链接已过期或配对密钥错误' })
    expect((await claim(relay.origin, live.roomID, live.pairSecret)).status).toBe(204)

    const expiredRoom = live.roomID
    const expiredSecret = live.pairSecret
    // Stop the host and let the hostless room expire, then probe the dead room.
    await service.stop()
    await waitFor(() => relay.roomCount() === 0, 'hostless room was never expired', 3_000)
    const expired = await probeRemotePairLink({
      origin: relay.origin,
      roomID: expiredRoom,
      pairSecret: expiredSecret
    })
    expect(expired).toEqual({ ok: false, reason: '链接已过期或配对密钥错误' })
  }, 15_000)

  it('does not let a stale check overwrite the regenerated pair url', async () => {
    const relay = await startRelay()
    relays.push(relay)
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    let claims = 0
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: await userData(),
      relayOrigin: relay.origin,
      backoffMs: () => 50,
      connect: connectWs,
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('/claim')) {
          claims += 1
          if (claims === 1) await firstGate
        }
        return fetch(input, init)
      }
    })
    services.push(service)
    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const oldUrl = service.getState().pairUrl
    const first = service.checkLink()
    await waitFor(() => service.getState().linkCheck?.status === 'checking', 'first check did not start')
    await service.reset()
    await waitFor(() => service.getState().status === 'ready', 'reset host never ready')
    const second = await service.checkLink()
    expect(second.linkCheck?.status).toBe('ok')
    expect(second.linkCheck?.pairUrl).toBe(service.getState().pairUrl)
    expect(second.linkCheck?.pairUrl).not.toBe(oldUrl)
    releaseFirst?.()
    await first
    expect(service.getState().linkCheck?.pairUrl).not.toBe(oldUrl)
    expect(service.getState().linkCheck?.status).toBe('ok')
    expect(service.getState().linkCheck?.pairUrl).toBe(second.linkCheck?.pairUrl)
  }, 15_000)

  it('does not claim over a live browser session', async () => {
    const relay = await startRelay()
    relays.push(relay)
    const dir = await userData()
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: dir,
      relayOrigin: relay.origin,
      backoffMs: () => 50,
      connect: connectWs
    })
    services.push(service)
    await service.start()
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const persisted = JSON.parse(await readFile(join(dir, REMOTE_CONTROL_STORE_FILE), 'utf8')) as RemoteControlStored
    const granted = await claim(relay.origin, persisted.roomID, persisted.pairSecret)
    const browser = new WebSocket(`ws://127.0.0.1:${new URL(relay.origin).port}/ws`, {
      headers: { Cookie: cookieHeader(granted.headers.get('set-cookie')) }
    } as never)
    const browserQ = installQueue(browser)
    await new Promise((resolve, reject) => {
      browser.addEventListener('open', resolve, { once: true })
      browser.addEventListener('error', () => reject(new Error('browser ws')), { once: true })
    })
    await waitFor(() => service.getState().status === 'paired', 'host never paired')
    const checked = await service.checkLink()
    expect(checked.linkCheck?.status).toBe('ok')
    browser.send(JSON.stringify({
      protocolVersion: 2,
      id: 'after-check',
      type: 'request',
      method: 'listProjects',
      params: []
    }))
    await expect(nextBusinessFrame(browserQ, browser)).resolves.toMatchObject({
      type: 'response',
      id: 'after-check',
      ok: true
    })
    browser.close()
  }, 15_000)

  it('exposes checkLink over IPC', async () => {
    const relay = await startRelay()
    relays.push(relay)
    let handler: ((event: { sender: { send(): void } }, command: RemoteControlCommand) => Promise<RemoteControlState>) | undefined
    const ipc = {
      handle(_channel: string, listener: typeof handler) {
        handler = listener
      }
    }
    const service = createRemoteControlService({
      backend: mockBackend(),
      userDataDir: await userData(),
      relayOrigin: relay.origin,
      connect: connectWs
    })
    services.push(service)
    registerRemoteControlIpc(ipc as never, service)
    await handler?.({ sender: { send() {} } }, { type: 'start' })
    await waitFor(() => service.getState().status === 'ready', 'host never ready')
    const checked = await handler?.({ sender: { send() {} } }, { type: 'checkLink' })
    expect(checked?.linkCheck?.status).toBe('ok')
  }, 15_000)
})

describe('bindRemoteControlPowerLifecycle', () => {
  it('reconnects on unlock and resume, and removes both listeners', () => {
    const listeners = new Map<string, () => void>()
    const on = vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) })
    const removeListener = vi.fn((event: string) => { listeners.delete(event) })
    const requestReconnect = vi.fn()
    const unbind = bindRemoteControlPowerLifecycle(
      { requestReconnect },
      { on, removeListener } as never,
    )

    expect(on).toHaveBeenNthCalledWith(1, 'lock-screen', expect.any(Function))
    expect(on).toHaveBeenNthCalledWith(2, 'unlock-screen', expect.any(Function))
    expect(on).toHaveBeenNthCalledWith(3, 'resume', expect.any(Function))
    listeners.get('lock-screen')?.()
    listeners.get('unlock-screen')?.()
    listeners.get('resume')?.()
    expect(requestReconnect).toHaveBeenCalledTimes(3)

    unbind()
    expect(removeListener).toHaveBeenNthCalledWith(1, 'lock-screen', expect.any(Function))
    expect(removeListener).toHaveBeenNthCalledWith(2, 'unlock-screen', expect.any(Function))
    expect(removeListener).toHaveBeenNthCalledWith(3, 'resume', expect.any(Function))
    expect(listeners).toHaveLength(0)
  })
})

describe('bindRemoteControlSleepPrevention', () => {
  function makeService(initialEnabled: boolean) {
    let listeners: Array<(state: RemoteControlState) => void> = []
    let state = { enabled: initialEnabled }
    return {
      service: {
        getState: () => state,
        subscribe(listener: (state: RemoteControlState) => void) {
          listeners.push(listener)
          return () => { listeners = listeners.filter(item => item !== listener) }
        }
      },
      setEnabled(enabled: boolean) {
        state = { ...state, enabled }
        for (const listener of [...listeners]) listener(state as RemoteControlState)
      }
    }
  }

  it('holds a blocker while enabled and releases it when disabled', () => {
    const start = vi.fn(() => 7)
    const stop = vi.fn()
    const { service, setEnabled } = makeService(false)
    const unbind = bindRemoteControlSleepPrevention(service as never, { start, stop })
    expect(start).not.toHaveBeenCalled()
    setEnabled(true)
    expect(start).toHaveBeenCalledWith('prevent-app-suspension')
    expect(start).toHaveBeenCalledTimes(1)
    setEnabled(true)
    expect(start).toHaveBeenCalledTimes(1)
    setEnabled(false)
    expect(stop).toHaveBeenCalledWith(7)
    expect(stop).toHaveBeenCalledTimes(1)
    setEnabled(true)
    expect(start).toHaveBeenCalledTimes(2)
    unbind()
    setEnabled(false)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('acquires immediately when the room is already enabled', () => {
    const start = vi.fn(() => 3)
    const stop = vi.fn()
    const { service } = makeService(true)
    bindRemoteControlSleepPrevention(service as never, { start, stop })
    expect(start).toHaveBeenCalledTimes(1)
  })
})
