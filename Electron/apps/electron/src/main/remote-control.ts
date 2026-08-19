import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createHostBackendSession,
  type HostBackend,
  type HostBackendSession,
  type HostWireFrame,
  parseHostWireFrame
} from '@pipi/host-api'
import {
  PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
  PIPI_REMOTE_CONTROL_IPC_CHANNEL,
  type RemoteControlCommand,
  type RemoteControlState,
  type RemoteControlStatus
} from './remote-control-ipc.js'
import type { RemoteDebugService, RemoteDebugState } from './remote-debug.js'

export {
  PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
  PIPI_REMOTE_CONTROL_IPC_CHANNEL,
  type RemoteControlCommand,
  type RemoteControlState,
  type RemoteControlStatus
} from './remote-control-ipc.js'

export const REMOTE_CONTROL_STORE_FILE = 'remote-control.json'

const HEX32_RE = /^[0-9a-f]{64}$/
const ROOM_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RemoteControlStored = {
  enabled: boolean
  roomID: string
  hostToken: string
  pairSecret: string
  relayOrigin: string
}

export type RemoteControlIpcMainLike = {
  handle(
    channel: string,
    listener: (
      event: { sender: { send(channel: string, state: RemoteControlState): void } },
      command: RemoteControlCommand
    ) => Promise<RemoteControlState>
  ): void
}

type SocketLike = {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener?(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void
  removeEventListener?(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void
  on?(type: string, listener: (...args: any[]) => void): void
  off?(type: string, listener: (...args: any[]) => void): void
}

export type RemoteControlServiceOptions = {
  backend: HostBackend
  userDataDir: string
  relayOrigin?: string
  now?: () => number
  connect?: (url: string) => SocketLike
  backoffMs?: (attempt: number) => number
  pingIntervalMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

export function hashPairSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function pairUrlFor(origin: string, roomID: string, pairSecret: string): string {
  return `${origin.replace(/\/$/, '')}/pair/${roomID}#${pairSecret}`
}

export function hostWsUrl(origin: string): string {
  const url = new URL(origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/relay/host'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function newRemoteIdentity(): Pick<RemoteControlStored, 'roomID' | 'hostToken' | 'pairSecret'> {
  return {
    roomID: randomUUID(),
    hostToken: randomBytes(32).toString('hex'),
    pairSecret: randomBytes(32).toString('hex')
  }
}

export function withRemoteSessionCapabilities(backend: HostBackend): HostBackend {
  return {
    async handle(method, params) {
      if (method === 'capabilities') {
        const caps = await backend.handle(method, params) as Record<string, unknown>
        return {
          ...caps,
          computerUse: false,
          terminal: false,
          browser: false,
          revealInFinder: false
        }
      }
      return backend.handle(method, params)
    },
    subscribe: listener => backend.subscribe(listener),
    close: backend.close?.bind(backend)
  }
}

function idleState(): RemoteControlState {
  return {
    enabled: false,
    status: 'idle',
    pairUrl: null,
    roomID: null,
    relayOrigin: null,
    hostEpoch: null,
    generation: null
  }
}

function parseStored(raw: unknown, fallbackOrigin?: string): RemoteControlStored | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const roomID = typeof value.roomID === 'string' ? value.roomID : ''
  const hostToken = typeof value.hostToken === 'string' ? value.hostToken.toLowerCase() : ''
  const pairSecret = typeof value.pairSecret === 'string' ? value.pairSecret.toLowerCase() : ''
  const relayOrigin = typeof value.relayOrigin === 'string' && value.relayOrigin
    ? value.relayOrigin
    : fallbackOrigin ?? ''
  if (!ROOM_ID_RE.test(roomID) || !HEX32_RE.test(hostToken) || !HEX32_RE.test(pairSecret) || !relayOrigin) {
    return null
  }
  return {
    enabled: value.enabled === true,
    roomID: roomID.toLowerCase(),
    hostToken,
    pairSecret,
    relayOrigin: relayOrigin.replace(/\/$/, '')
  }
}

function defaultBackoff(attempt: number, rng: () => number = Math.random): number {
  const spread = Math.min(15_000, 500 * 2 ** Math.max(0, attempt))
  const delay = Math.round((0.5 + rng()) * spread)
  return Math.min(15_000, Math.max(500, delay))
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function defaultConnect(url: string): SocketLike {
  const socket = new WebSocket(url) as unknown as SocketLike
  return socket
}

function decodeSocketPayload(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (raw && typeof raw === 'object') {
    const record = raw as { data?: unknown; toString?: () => string }
    if (typeof record.data === 'string') return record.data
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(record.data)) return record.data.toString('utf8')
    if (record.data instanceof ArrayBuffer) return Buffer.from(record.data).toString('utf8')
    if (ArrayBuffer.isView(record.data)) return Buffer.from(record.data.buffer).toString('utf8')
  }
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer).toString('utf8')
  return String(raw)
}

export function createRemoteControlService(options: RemoteControlServiceOptions) {
  const listeners = new Set<(state: RemoteControlState) => void>()
  const remoteBackend = withRemoteSessionCapabilities(options.backend)
  const now = options.now ?? Date.now
  const connect = options.connect ?? defaultConnect
  const backoffMs = options.backoffMs ?? defaultBackoff
  const pingIntervalMs = options.pingIntervalMs ?? 20_000
  const sleep = options.sleep ?? defaultSleep
  const storePath = join(options.userDataDir, REMOTE_CONTROL_STORE_FILE)

  let state = idleState()
  let stored: RemoteControlStored | null = null
  let socket: SocketLike | null = null
  let session: HostBackendSession | null = null
  let generation = 0
  let hostEpoch = 0
  let reconnectAttempt = 0
  let runToken = 0
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let loopAbort: AbortController | null = null
  let stopping = false

  const emit = (patch: Partial<RemoteControlState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  const persist = async () => {
    if (!stored) return
    await mkdir(options.userDataDir, { recursive: true })
    await writeFile(storePath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  }

  const pairUrl = () => stored ? pairUrlFor(stored.relayOrigin, stored.roomID, stored.pairSecret) : null

  const publishIdentity = (status: RemoteControlStatus, extra: Partial<RemoteControlState> = {}) => {
    emit({
      enabled: Boolean(stored?.enabled),
      status,
      pairUrl: pairUrl(),
      roomID: stored?.roomID ?? null,
      relayOrigin: stored?.relayOrigin ?? null,
      hostEpoch: hostEpoch || null,
      generation: generation || null,
      ...extra
    })
  }

  const clearTransport = async () => {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = undefined
    }
    const currentSession = session
    session = null
    const currentSocket = socket
    socket = null
    if (currentSession) await currentSession.close()
    if (currentSocket && currentSocket.readyState < 2) {
      try { currentSocket.close(1000, 'host stop') } catch { /* already closed */ }
    }
  }

  const bindSession = (target: SocketLike) => {
    const bound = createHostBackendSession(remoteBackend, frame => {
      if (target.readyState !== 1) return
      try {
        target.send(JSON.stringify({
          ...frame,
          ...(hostEpoch ? { hostEpoch } : {}),
          ...(generation ? { generation } : {})
        }))
      } catch { /* close race */ }
    })
    session = bound
  }

  const isLate = (value: Record<string, unknown>): boolean => {
    const frameEpoch = typeof value.hostEpoch === 'number' ? value.hostEpoch : undefined
    const frameGeneration = typeof value.generation === 'number' ? value.generation : undefined
    if (frameEpoch !== undefined && hostEpoch !== 0 && frameEpoch < hostEpoch) return true
    if (frameGeneration !== undefined && generation !== 0 && frameGeneration < generation) return true
    return false
  }

  const handlePayload = (raw: unknown) => {
    const text = decodeSocketPayload(raw)
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return }
    if (!parsed || typeof parsed !== 'object') return
    const value = parsed as Record<string, unknown>
    if (value.v === 2 && typeof value.type === 'string') {
      if (value.type === 'pong') return
      if (value.type === 'ready') {
        hostEpoch = typeof value.hostEpoch === 'number' ? value.hostEpoch : hostEpoch
        publishIdentity(value.browserAttached === true ? 'paired' : 'ready')
        return
      }
      if (value.type === 'paired') {
        hostEpoch = typeof value.hostEpoch === 'number' ? value.hostEpoch : hostEpoch
        generation = typeof value.generation === 'number' ? value.generation : generation
        publishIdentity('paired')
        return
      }
      if (value.type === 'end' || value.type === 'expired') {
        stopping = true
        stored = stored ? { ...stored, enabled: false } : stored
        void persist()
        publishIdentity(value.type === 'expired' ? 'error' : 'stopped', {
          error: value.type === 'expired' ? 'link expired' : undefined
        })
        void clearTransport()
        return
      }
      if (value.type === 'replaced') {
        hostEpoch = typeof value.hostEpoch === 'number' ? value.hostEpoch : hostEpoch
        return
      }
      return
    }
    if (isLate(value)) return
    const parsedFrame = parseHostWireFrame(value)
    if (!parsedFrame.ok || parsedFrame.frame.type !== 'request') return
    session?.receive(parsedFrame.frame as HostWireFrame)
  }

  const openOnce = (token: number): Promise<void> => new Promise((resolve, reject) => {
    if (!stored) {
      reject(new Error('missing room'))
      return
    }
    const target = connect(hostWsUrl(stored.relayOrigin))
    socket = target
    const hello = {
      v: 2,
      type: 'hello',
      roomID: stored.roomID,
      hostToken: stored.hostToken,
      pairSecretHash: hashPairSecret(stored.pairSecret)
    }
    let opened = false
    const onOpen = () => {
      if (opened) return
      opened = true
      try { target.send(JSON.stringify(hello)) } catch (error) { reject(error) }
      bindSession(target)
      reconnectAttempt = 0
      pingTimer = setInterval(() => {
        if (target.readyState !== 1) return
        try { target.send(JSON.stringify({ v: 2, type: 'ping', at: now() })) } catch { /* ignore */ }
      }, pingIntervalMs)
      if (typeof pingTimer === 'object' && 'unref' in pingTimer) (pingTimer as NodeJS.Timeout).unref()
    }
    const onMessage = (event: { data?: unknown } | string) => {
      if (token !== runToken) return
      const payload = typeof event === 'string' || Buffer.isBuffer(event)
        ? event
        : event && typeof event === 'object' && 'data' in event
          ? event.data
          : event
      handlePayload(payload)
    }
    const onClose = () => {
      if (target.on && target.off) {
        target.off('open', onOpen)
        target.off('message', onMessage)
        target.off('close', onClose)
        target.off('error', onError)
      } else {
        target.removeEventListener?.('open', onOpen)
        target.removeEventListener?.('message', onMessage)
        target.removeEventListener?.('close', onClose)
        target.removeEventListener?.('error', onError)
      }
      resolve()
    }
    const onError = () => {
      /* close follows */
    }
    if (target.on) {
      target.on('open', onOpen)
      target.on('message', onMessage)
      target.on('close', onClose)
      target.on('error', onError)
    } else {
      target.addEventListener?.('open', onOpen)
      target.addEventListener?.('message', onMessage)
      target.addEventListener?.('close', onClose)
      target.addEventListener?.('error', onError)
    }
    if (target.readyState === 1) onOpen()
  })

  const runLoop = async () => {
    const token = ++runToken
    loopAbort?.abort()
    const abort = new AbortController()
    loopAbort = abort
    stopping = false
    while (!stopping && token === runToken && stored?.enabled) {
      publishIdentity(reconnectAttempt === 0 ? 'connecting' : 'reconnecting')
      try {
        await openOnce(token)
      } catch (error) {
        emit({ error: error instanceof Error ? error.message : String(error) })
      }
      await clearTransport()
      if (stopping || token !== runToken || !stored?.enabled) break
      reconnectAttempt += 1
      publishIdentity('reconnecting')
      try {
        await sleep(backoffMs(reconnectAttempt - 1), abort.signal)
      } catch {
        break
      }
    }
  }

  const ensureStored = (relayOrigin?: string): RemoteControlStored => {
    const origin = (relayOrigin ?? stored?.relayOrigin ?? options.relayOrigin ?? '').replace(/\/$/, '')
    if (!origin) throw new Error('relay origin is required')
    if (stored && stored.relayOrigin === origin) return stored
    stored = { enabled: false, relayOrigin: origin, ...newRemoteIdentity() }
    return stored
  }

  const start = async (relayOrigin?: string) => {
    stored = { ...ensureStored(relayOrigin), enabled: true }
    await persist()
    reconnectAttempt = 0
    void runLoop()
    return getState()
  }

  const stop = async () => {
    stopping = true
    runToken += 1
    loopAbort?.abort()
    if (stored) stored = { ...stored, enabled: false }
    await persist()
    await clearTransport()
    publishIdentity('stopped')
    return getState()
  }

  const reset = async (relayOrigin?: string) => {
    const optionOrigin = (options.relayOrigin ?? '').replace(/\/$/, '')
    const storedOrigin = stored?.relayOrigin
    const origin = (relayOrigin ?? (storedOrigin && optionOrigin && storedOrigin !== optionOrigin ? optionOrigin : storedOrigin) ?? optionOrigin).replace(/\/$/, '')
    if (!origin) throw new Error('relay origin is required')
    stopping = true
    runToken += 1
    loopAbort?.abort()
    await clearTransport()
    stored = { enabled: true, relayOrigin: origin, ...newRemoteIdentity() }
    hostEpoch = 0
    generation = 0
    reconnectAttempt = 0
    await persist()
    stopping = false
    void runLoop()
    return getState()
  }

  const getState = () => state

  const restore = async () => {
    try {
      stored = parseStored(JSON.parse(await readFile(storePath, 'utf8')), options.relayOrigin)
    } catch {
      stored = parseStored(null, options.relayOrigin)
    }
    if (!stored) {
      if (options.relayOrigin) {
        stored = { enabled: false, relayOrigin: options.relayOrigin.replace(/\/$/, ''), ...newRemoteIdentity() }
        publishIdentity('idle')
      }
      return getState()
    }
    publishIdentity(stored.enabled ? 'connecting' : 'idle')
    if (stored.enabled) void runLoop()
    return getState()
  }

  return {
    getState,
    start,
    stop,
    reset,
    restore,
    subscribe(listener: (state: RemoteControlState) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Test hook: drop the outbound host socket without disabling the room. */
    dropConnection() {
      if (socket && socket.readyState < 2) {
        try { socket.close(4000, 'test drop') } catch { /* ignore */ }
      }
    }
  }
}

export type RemoteControlService = ReturnType<typeof createRemoteControlService>

function mergeRemoteState(relay: RemoteControlState, debug?: RemoteDebugState): RemoteControlState {
  return {
    ...relay,
    debugEnabled: debug?.debugEnabled ?? false,
    debugUrl: debug?.debugUrl ?? null,
    ...(debug?.debugError ? { debugError: debug.debugError } : {})
  }
}

export function registerRemoteControlIpc(
  ipc: RemoteControlIpcMainLike,
  service: RemoteControlService,
  channel = PIPI_REMOTE_CONTROL_IPC_CHANNEL,
  eventChannel = PIPI_REMOTE_CONTROL_EVENT_CHANNEL,
  debug?: RemoteDebugService
): void {
  const renderers = new Set<{ send(channel: string, state: RemoteControlState): void }>()
  const publish = (state: RemoteControlState) => {
    for (const renderer of renderers) renderer.send(eventChannel, state)
  }
  service.subscribe(state => publish(mergeRemoteState(state, debug?.getState())))
  debug?.subscribe(debugState => publish(mergeRemoteState(service.getState(), debugState)))
  ipc.handle(channel, async (event, command) => {
    renderers.add(event.sender)
    const type = command?.type
    if (type === 'start') return mergeRemoteState(await service.start(command.relayOrigin), debug?.getState())
    if (type === 'stop') return mergeRemoteState(await service.stop(), debug?.getState())
    if (type === 'reset') return mergeRemoteState(await service.reset(command.relayOrigin), debug?.getState())
    if (type === 'startDebug') {
      const next = debug ? await debug.start() : { debugEnabled: false, debugUrl: null, debugError: 'debug service unavailable' }
      return mergeRemoteState(service.getState(), next)
    }
    if (type === 'stopDebug') {
      const next = debug ? await debug.stop() : { debugEnabled: false, debugUrl: null }
      return mergeRemoteState(service.getState(), next)
    }
    return mergeRemoteState(service.getState(), debug?.getState())
  })
}
