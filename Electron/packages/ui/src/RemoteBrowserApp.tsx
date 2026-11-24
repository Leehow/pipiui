import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'
import { createWsHost, type WebSocketLike } from '@pipi/host-api'
import { App, createMockHost } from './App'
import { safeExternalURL, type BrowserSocket } from './browser-host'
import {
  BROWSER_APP_PING_MS,
  PHASE_HYSTERESIS_MS,
  classifyRemoteClose,
  displayRemotePhase,
  nextReconnectDelayMs,
  parsePairLocation,
  phaseLabel,
  readControlType,
  readStoredRemotePair,
  remoteCloseCopy,
  writeStoredRemotePair,
  type RemoteCloseCopy,
  type RemoteCloseKind,
  type RemotePhase,
  type StoredRemotePair,
} from './remote-browser-session'

export type RemoteBrowserAppOptions = {
  demo?: boolean
  demoHost?: () => PipiHostAPI
  location?: Pick<Location, 'protocol' | 'host' | 'pathname' | 'hash'>
  historyReplace?: (url: string) => void
  fetch?: typeof fetch
  socket?: (url: string) => BrowserSocket
  open?: (url: string, target: string, features: string) => Window | null
  now?: () => number
  schedule?: (fn: () => void, ms: number) => number
  cancel?: (id: number) => void
  hysteresisMs?: number
  connectionTimeoutMs?: number
  heartbeatTimeoutMs?: number
  pingIntervalMs?: number
}

type SocketClose = { code?: number; reason?: string }

function decorateHost(host: PipiHostAPI, open: RemoteBrowserAppOptions['open']): PipiHostAPI {
  const opener = open ?? (typeof window !== 'undefined' ? window.open.bind(window) : undefined)
  if (!opener) return host
  host.openExternal = async raw => {
    const popup = opener(safeExternalURL(raw), '_blank', 'noopener,noreferrer')
    if (!popup) throw new Error('浏览器阻止了登录窗口；请允许弹窗或手动打开登录地址。')
  }
  return host
}

async function claimPair(
  pairID: string,
  secret: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  const page = await fetchImpl(`/pair/${pairID}`, { credentials: 'same-origin', signal })
  if (page.status === 404 || page.status === 403) {
    const error = new Error('pairing rejected') as Error & { closeKind: ReturnType<typeof classifyRemoteClose> }
    error.closeKind = page.status === 404 ? 'expired' : 'auth'
    throw error
  }
  if (!page.ok) {
    const error = new Error('pairing rejected') as Error & { closeKind: ReturnType<typeof classifyRemoteClose> }
    error.closeKind = page.status >= 500 || page.status === 429 ? 'transient' : 'auth'
    throw error
  }
  if (signal.aborted) throw new Error('connection cancelled')
  const claim = await fetchImpl(`/pair/${pairID}/claim`, {
    method: 'POST',
    signal,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret }),
  })
  if (!claim.ok) {
    const error = new Error('pairing rejected') as Error & { closeKind: ReturnType<typeof classifyRemoteClose> }
    error.closeKind = claim.status === 404 ? 'expired' : claim.status >= 500 || claim.status === 429 ? 'transient' : 'auth'
    throw error
  }
}

async function bounded<T>(work: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) throw new Error('connection cancelled')
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      abort = () => reject(new Error('connection cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => reject(new Error('connection timed out')), timeoutMs)
    })])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

async function waitForSocket(socket: BrowserSocket, signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (socket.readyState === 1) return
  let succeed = () => {}
  let fail: (event?: SocketClose) => void = () => {}
  try {
    await bounded(new Promise<void>((resolve, reject) => {
      succeed = resolve
      fail = event => reject(Object.assign(new Error(event?.reason || 'socket closed'), {
        code: event?.code, reason: event?.reason
      }))
      socket.addEventListener('open', succeed)
      socket.addEventListener('error', fail)
      socket.addEventListener('close', fail)
      if (socket.readyState >= 2) fail()
    }), signal, timeoutMs)
  } finally {
    socket.removeEventListener('open', succeed)
    socket.removeEventListener('error', fail)
    socket.removeEventListener('close', fail)
  }
}

export function RemoteBrowserApp(options: RemoteBrowserAppOptions = {}) {
  const [attempt, setAttempt] = useState(0)
  const [host, setHost] = useState<PipiHostAPI | null>(null)
  const [phase, setPhase] = useState<RemotePhase>('connecting')
  const [closeCopy, setCloseCopy] = useState<RemoteCloseCopy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const retry = useCallback(() => {
    setCloseCopy(null)
    setError(null)
    setAttempt(value => value + 1)
  }, [])

  const [displayPhase, setDisplayPhase] = useState<RemotePhase>(phase)
  useEffect(() => {
    const reconnectable = Boolean(closeCopy?.reconnect) || phase === 'reconnecting'
    const next = displayRemotePhase(phase, reconnectable)
    if (next === 'connected' || next === 'connecting' || next === 'pairing') {
      setDisplayPhase(next)
      return
    }
    if (next === 'disconnected' && closeCopy && !closeCopy.reconnect) {
      setDisplayPhase('disconnected')
      return
    }
    const wait = options.hysteresisMs ?? PHASE_HYSTERESIS_MS
    const id = window.setTimeout(() => setDisplayPhase('reconnecting'), wait)
    return () => window.clearTimeout(id)
  }, [phase, closeCopy, options.hysteresisMs])

  useEffect(() => {
    let stopped = false
    const lifetime = new AbortController()
    const opts = optionsRef.current
    const timeoutMs = opts.connectionTimeoutMs ?? 10_000
    const heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 60_000
    const now = opts.now ?? Date.now
    const demo = opts.demo ?? (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PIPIUI_DEMO === 'true'
    if (demo) {
      setPhase('connecting')
      const next = (opts.demoHost ?? createMockHost)()
      setHost(next)
      setPhase('connected')
      return () => { stopped = true }
    }

    const location = opts.location ?? (typeof window !== 'undefined' ? window.location : { protocol: 'http:', host: 'localhost', pathname: '/', hash: '' })
    const fetchImpl = opts.fetch ?? fetch.bind(globalThis)
    const socketFactory = opts.socket ?? (url => new WebSocket(url) as BrowserSocket)
    const schedule = opts.schedule ?? ((fn, ms) => window.setTimeout(fn, ms))
    const cancel = opts.cancel ?? (id => window.clearTimeout(id))
    const replace = opts.historyReplace ?? (url => { history.replaceState(null, '', url) })
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsURL = `${protocol}//${location.host}/ws`

    let reconnectAttempt = 0
    let timer = 0
    let pingTimer = 0
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    let pendingReconnect = false
    let connectionInFlight = false
    let retryAfterAttempt = false
    let terminalStop = false
    let lastReceivedAt = now()
    let lastConnectedAt = 0
    let detachSocketStop: (() => void) | undefined
    let activeSocket: BrowserSocket | undefined
    let socketLifetime: AbortController | undefined
    let lastControl: string | undefined
    let controlListener: ((raw: unknown) => void) | undefined

    const applyClose = (kind: ReturnType<typeof classifyRemoteClose>) => {
      const copy = remoteCloseCopy(kind)
      setCloseCopy(copy)
      if (!copy.reconnect) {
        terminalStop = true
        setPhase('disconnected')
        setError(copy.detail)
        return false
      }
      return true
    }

    const failUnrecoverable = (kind: RemoteCloseKind) => {
      applyClose(kind)
      setPhase('disconnected')
      setError(remoteCloseCopy(kind).detail)
    }

    const runClaim = async (pair: StoredRemotePair): Promise<boolean> => {
      setPhase('pairing')
      try {
        const claimAbort = new AbortController()
        const abortClaim = () => claimAbort.abort()
        lifetime.signal.addEventListener('abort', abortClaim, { once: true })
        const timer = setTimeout(abortClaim, timeoutMs)
        try { await bounded(claimPair(pair.pairID, pair.secret, fetchImpl, claimAbort.signal), lifetime.signal, timeoutMs) }
        finally {
          clearTimeout(timer)
          claimAbort.abort()
          lifetime.signal.removeEventListener('abort', abortClaim)
        }
        if (stopped) return false
        writeStoredRemotePair(pair)
        return true
      } catch (reason) {
        if (stopped) return false
        let kind = (reason as { closeKind?: RemoteCloseKind }).closeKind ?? 'transient'
        // A restarted relay forgets rooms briefly until the desktop re-registers.
        // Its claim endpoint deliberately reports a missing room as 403, just
        // like invalid credentials. Only a previously proven connection gets
        // this bounded recovery window; explicit replaced/expired controls stop.
        if ((kind === 'expired' || kind === 'auth') && lastConnectedAt && now() - lastConnectedAt < 60_000) kind = 'transient'
        if (applyClose(kind)) scheduleReconnect()
        return false
      }
    }

    const shouldAutoReclaim = (kind: RemoteCloseKind) =>
      kind === 'auth' || kind === 'transient' || kind === 'unknown'

    const stopPing = () => {
      if (pingTimer) {
        window.clearInterval(pingTimer)
        pingTimer = 0
      }
    }

    const retireSocket = (socket?: BrowserSocket) => {
      if (!socket) return
      socketLifetime?.abort()
      stopPing()
      detachSocketStop?.()
      detachSocketStop = undefined
      if (controlListener) {
        socket.removeEventListener('message', controlListener)
        controlListener = undefined
      }
      try { socket.close() } catch { /* ignore */ }
      if (activeSocket === socket) activeSocket = undefined
    }

    const attachControlListener = (socket: BrowserSocket) => {
      const onMessage = (raw: unknown) => {
        lastReceivedAt = now()
        const type = readControlType(raw)
        if (type && type !== 'pong' && type !== 'ping') lastControl = type
        if (type === 'error') {
          const data = raw && typeof raw === 'object' && 'data' in raw ? (raw as { data: unknown }).data : raw
          try {
            const frame = typeof data === 'string' ? JSON.parse(data) : data
            if (frame?.reason === 'host_offline') socket.close()
          } catch { /* invalid controls are ignored */ }
        }
      }
      controlListener = onMessage
      socket.addEventListener('message', onMessage)
      return onMessage
    }

    const openFreshSocket = (): BrowserSocket => {
      if (activeSocket) retireSocket(activeSocket)
      const socket = socketFactory(wsURL)
      activeSocket = socket
      socketLifetime = new AbortController()
      lastReceivedAt = now()
      lastControl = undefined
      attachControlListener(socket)
      return socket
    }

    const openSocket = async (mode: 'connecting' | 'reconnecting'): Promise<BrowserSocket | null> => {
      if (stopped) return null
      setPhase(mode === 'reconnecting' ? 'reconnecting' : 'connecting')
      const socket = openFreshSocket()
      try {
        await waitForSocket(socket, lifetime.signal, timeoutMs)
        return socket
      } catch (reason) {
        retireSocket(socket)
        if (stopped) return null
        const kind = classifyRemoteClose({
          code: (reason as SocketClose).code,
          reason: (reason as SocketClose).reason,
          controlType: lastControl,
        })
        const stored = readStoredRemotePair()
        if (kind === 'replaced' || kind === 'expired') {
          failUnrecoverable(kind)
          return null
        }
        if (shouldAutoReclaim(kind) && stored) {
          if (!(await runClaim(stored))) return null
          if (stopped) return null
          setPhase(mode === 'reconnecting' ? 'reconnecting' : 'connecting')
          const retrySocket = openFreshSocket()
          try {
            await waitForSocket(retrySocket, lifetime.signal, timeoutMs)
            return retrySocket
          } catch (retryReason) {
            retireSocket(retrySocket)
            if (stopped) return null
            const retryKind = classifyRemoteClose({
              code: (retryReason as SocketClose).code,
              reason: (retryReason as SocketClose).reason,
              controlType: lastControl,
            })
            if (!applyClose(retryKind)) return null
            scheduleReconnect()
            return null
          }
        }
        if (!applyClose(kind)) return null
        scheduleReconnect()
        return null
      }
    }

    const connectOnce = async (mode: 'connecting' | 'reconnecting') => {
      if (stopped) return
      setPhase(mode)
      setError(null)
      const pair = parsePairLocation(location.pathname, location.hash)
      if (pair && 'error' in pair) {
        setPhase('disconnected')
        setCloseCopy(remoteCloseCopy('auth'))
        setError(pair.error)
        return
      }
      if (pair && 'pairID' in pair) {
        if (!(await runClaim(pair))) return
        replace(`${location.pathname}${location.hash}`)
      } else if (mode === 'connecting') {
        const stored = readStoredRemotePair()
        if (stored) {
          if (!(await runClaim(stored))) return
        }
      }
      if (stopped) return
      const socket = await openSocket(mode)
      if (!socket) return
      if (stopped) {
        socket.close()
        return
      }
      const nextHost = decorateHost(createWsHost(socket as WebSocketLike, { signal: socketLifetime?.signal }), opts.open)
      try {
        await bounded(nextHost.capabilities(), lifetime.signal, timeoutMs)
      } catch {
        retireSocket(socket)
        if (!stopped) {
          const kind = classifyRemoteClose({ controlType: lastControl })
          if (kind === 'expired' || kind === 'replaced') failUnrecoverable(kind)
          else scheduleReconnect()
        }
        return
      }
      if (stopped || socket !== activeSocket || socket.readyState !== 1) return
      reconnectAttempt = 0
      lastConnectedAt = now()
      setHost(nextHost)
      setPhase('connected')
      setCloseCopy(null)
      stopPing()
      pingTimer = window.setInterval(() => {
        if (now() - lastReceivedAt >= heartbeatTimeoutMs) {
          socketLifetime?.abort()
          socket.close()
          onStop({ code: 1006, reason: 'heartbeat timed out' })
          return
        }
        try { socket.send(JSON.stringify({ v: 2, type: 'ping', at: Date.now() })) } catch { /* ignore */ }
      }, opts.pingIntervalMs ?? BROWSER_APP_PING_MS)
      let socketStopped = false
      const onStop = (event?: SocketClose) => {
        if (socketStopped) return
        socketStopped = true
        socketLifetime?.abort()
        lastConnectedAt = now()
        stopPing()
        socket.removeEventListener('close', onStop)
        socket.removeEventListener('error', onStop)
        if (stopped) return
        const kind = classifyRemoteClose({
          code: event?.code,
          reason: event?.reason,
          controlType: lastControl,
        })
        if (lastControl === 'end') {
          terminalStop = true
          applyClose('host_offline')
          setPhase('disconnected')
          setError(remoteCloseCopy('host_offline').detail)
          return
        }
        if (kind === 'replaced' || kind === 'expired') {
          failUnrecoverable(kind)
          return
        }
        if (shouldAutoReclaim(kind) && readStoredRemotePair()) {
          scheduleReconnect()
          return
        }
        if (!applyClose(kind)) return
        scheduleReconnect()
      }
      socket.addEventListener('close', onStop)
      socket.addEventListener('error', onStop)
      detachSocketStop = () => {
        socket.removeEventListener('close', onStop)
        socket.removeEventListener('error', onStop)
      }
    }

    const connect = async (mode: 'connecting' | 'reconnecting') => {
      if (stopped || terminalStop || connectionInFlight) return
      cancel(timer)
      timer = 0
      connectionInFlight = true
      try {
        await connectOnce(mode)
      } catch {
        retireSocket(activeSocket)
        if (!stopped) scheduleReconnect()
      } finally {
        connectionInFlight = false
        if (retryAfterAttempt && !stopped) {
          retryAfterAttempt = false
          scheduleReconnect()
        }
      }
    }

    const scheduleReconnect = (immediate = false) => {
      if (stopped || terminalStop) return
      setPhase('reconnecting')
      if (connectionInFlight) { retryAfterAttempt = true; return }
      cancel(timer)
      timer = 0
      if (hidden && !immediate) {
        pendingReconnect = true
        return
      }
      pendingReconnect = false
      const delay = immediate ? 0 : nextReconnectDelayMs(reconnectAttempt)
      if (!immediate) reconnectAttempt += 1
      else reconnectAttempt = 0
      timer = schedule(() => { void connect('reconnecting') }, delay)
    }

    const onForeground = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        hidden = true
        if (timer) {
          cancel(timer)
          timer = 0
          pendingReconnect = true
        }
        return
      }
      hidden = false
      // pageshow also fires on first load, while claimPair is still awaiting
      // HTTP and no socket exists yet. Starting another claim here revokes
      // the first attempt's grant and leaves the UI bound to a dead socket.
      if (stopped || terminalStop || connectionInFlight) return
      const open = activeSocket && (activeSocket.readyState === 0 || activeSocket.readyState === 1)
      if (open && now() - lastReceivedAt < heartbeatTimeoutMs) return
      if (open) retireSocket(activeSocket)
      scheduleReconnect(true)
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onForeground)
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', onForeground)
      window.addEventListener('online', onForeground)
    }

    void connect('connecting')
    return () => {
      stopped = true
      lifetime.abort()
      cancel(timer)
      stopPing()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onForeground)
      if (typeof window !== 'undefined') window.removeEventListener('pageshow', onForeground)
        window.removeEventListener('online', onForeground)
      retireSocket(activeSocket)
    }
  }, [attempt])

  if (host) {
    return (
      <div className="remote-browser-shell">
        {displayPhase !== 'connected' && <div className="remote-browser-banner" role="status" data-testid="remote-lifecycle" data-phase={displayPhase} data-recovery="v2">
          <strong>{displayPhase !== 'disconnected' ? phaseLabel('reconnecting') : (closeCopy?.title ?? phaseLabel(displayPhase))}</strong>
          {closeCopy && displayPhase === 'disconnected' && <span>{closeCopy.detail}</span>}
          <button type="button" onClick={retry}>{closeCopy?.action ?? '立即重试'}</button>
        </div>}
        <App host={host} />
      </div>
    )
  }

  return (
    <main className="browser-host-state" role={error ? 'alert' : 'status'} data-testid="remote-lifecycle" data-phase={displayPhase} data-recovery="v2">
      {error ? (
        <section className="browser-host-error">
          <h1>{closeCopy?.title ?? '网页未连接到 Pi'}</h1>
          <p>{error}</p>
          {closeCopy && <p className="browser-host-hint">{closeCopy.action}</p>}
          <button type="button" onClick={retry}>重试连接</button>
        </section>
      ) : (
        <p>{phaseLabel(phase)}</p>
      )}
    </main>
  )
}
