import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'
import { createWsHost, type WebSocketLike } from '@pipi/host-api'
import { App, createMockHost } from './App'
import { safeExternalURL, type BrowserSocket } from './browser-host'
import {
  classifyRemoteClose,
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
): Promise<void> {
  const page = await fetchImpl(`/pair/${pairID}`, { credentials: 'same-origin' })
  if (page.status === 404 || page.status === 403) {
    const error = new Error('pairing rejected') as Error & { closeKind: ReturnType<typeof classifyRemoteClose> }
    error.closeKind = page.status === 404 ? 'expired' : 'auth'
    throw error
  }
  if (!page.ok) {
    const error = new Error('pairing rejected') as Error & { closeKind: ReturnType<typeof classifyRemoteClose> }
    error.closeKind = 'auth'
    throw error
  }
  const claim = await fetchImpl(`/pair/${pairID}/claim`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret }),
  })
  if (!claim.ok) {
    const error = new Error('pairing rejected') as Error & { closeKind: ReturnType<typeof classifyRemoteClose> }
    error.closeKind = claim.status === 404 ? 'expired' : 'auth'
    throw error
  }
}

function waitForSocket(socket: BrowserSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const succeed = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const fail = (event?: SocketClose) => {
      if (settled) return
      settled = true
      const error = new Error(event?.reason || 'socket closed') as Error & SocketClose
      error.code = event?.code
      error.reason = event?.reason
      reject(error)
    }
    socket.addEventListener('open', succeed, { once: true })
    socket.addEventListener('error', fail, { once: true })
    socket.addEventListener('close', fail, { once: true })
    if (socket.readyState === 1) succeed()
  })
}

export function RemoteBrowserApp(options: RemoteBrowserAppOptions = {}) {
  const [attempt, setAttempt] = useState(0)
  const [host, setHost] = useState<PipiHostAPI | null>(null)
  const [phase, setPhase] = useState<RemotePhase>('connecting')
  const [closeCopy, setCloseCopy] = useState<RemoteCloseCopy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const retry = useCallback(() => {
    setCloseCopy(null)
    setError(null)
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    stopRef.current = false
    const opts = optionsRef.current
    const demo = opts.demo ?? (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PIPIUI_DEMO === 'true'
    if (demo) {
      setPhase('connecting')
      const next = (opts.demoHost ?? createMockHost)()
      setHost(next)
      setPhase('connected')
      return () => { stopRef.current = true }
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
    let activeSocket: BrowserSocket | undefined
    let lastControl: string | undefined

    const applyClose = (kind: ReturnType<typeof classifyRemoteClose>) => {
      const copy = remoteCloseCopy(kind)
      setCloseCopy(copy)
      if (!copy.reconnect) {
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
        await claimPair(pair.pairID, pair.secret, fetchImpl)
        writeStoredRemotePair(pair)
        return true
      } catch (reason) {
        if (stopRef.current) return false
        const kind = (reason as { closeKind?: RemoteCloseKind }).closeKind ?? 'auth'
        failUnrecoverable(kind)
        return false
      }
    }

    const shouldAutoReclaim = (kind: RemoteCloseKind) =>
      kind === 'auth' || kind === 'transient' || kind === 'unknown'

    const attachControlListener = (socket: BrowserSocket) => {
      const onMessage = (raw: unknown) => {
        const type = readControlType(raw)
        if (type) lastControl = type
      }
      socket.addEventListener('message', onMessage)
      return onMessage
    }

    const openSocket = async (mode: 'connecting' | 'reconnecting'): Promise<BrowserSocket | null> => {
      if (stopRef.current) return null
      setPhase(mode === 'reconnecting' ? 'reconnecting' : 'connecting')
      const socket = socketFactory(wsURL)
      activeSocket = socket
      lastControl = undefined
      attachControlListener(socket)
      try {
        await waitForSocket(socket)
        return socket
      } catch (reason) {
        if (stopRef.current) return null
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
          if (stopRef.current) return null
          setPhase(mode === 'reconnecting' ? 'reconnecting' : 'connecting')
          const retrySocket = socketFactory(wsURL)
          activeSocket = retrySocket
          lastControl = undefined
          attachControlListener(retrySocket)
          try {
            await waitForSocket(retrySocket)
            return retrySocket
          } catch (retryReason) {
            if (stopRef.current) return null
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

    const connect = async (mode: 'connecting' | 'reconnecting') => {
      if (stopRef.current) return
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
        replace('/')
      } else if (mode === 'connecting') {
        const stored = readStoredRemotePair()
        if (stored) {
          if (!(await runClaim(stored))) return
        }
      }
      if (stopRef.current) return
      const socket = await openSocket(mode)
      if (!socket) return
      if (stopRef.current) {
        socket.close()
        return
      }
      reconnectAttempt = 0
      const nextHost = decorateHost(createWsHost(socket as WebSocketLike), opts.open)
      setHost(nextHost)
      setPhase('connected')
      setCloseCopy(null)
      const onStop = (event?: SocketClose) => {
        socket.removeEventListener('close', onStop)
        socket.removeEventListener('error', onStop)
        if (stopRef.current) return
        const kind = classifyRemoteClose({
          code: event?.code,
          reason: event?.reason,
          controlType: lastControl,
        })
        if (lastControl === 'end') {
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
    }

    const scheduleReconnect = () => {
      if (stopRef.current) return
      setPhase('reconnecting')
      const delay = nextReconnectDelayMs(reconnectAttempt)
      reconnectAttempt += 1
      timer = schedule(() => { void connect('reconnecting') }, delay)
    }

    void connect('connecting')
    return () => {
      stopRef.current = true
      cancel(timer)
      activeSocket?.close()
    }
  }, [attempt])

  if (host && phase === 'connected') return <App host={host} />

  if (host && (phase === 'reconnecting' || phase === 'disconnected')) {
    return (
      <div className="remote-browser-shell">
        <div className="remote-browser-banner" role="status" data-testid="remote-lifecycle" data-phase={phase} data-recovery="v2">
          <strong>{closeCopy?.title ?? phaseLabel(phase)}</strong>
          {closeCopy && <span>{closeCopy.detail}</span>}
          <button type="button" onClick={retry}>{closeCopy?.action ?? '立即重试'}</button>
        </div>
        <App host={host} />
      </div>
    )
  }

  return (
    <main className="browser-host-state" role={error ? 'alert' : 'status'} data-testid="remote-lifecycle" data-phase={phase} data-recovery="v2">
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
