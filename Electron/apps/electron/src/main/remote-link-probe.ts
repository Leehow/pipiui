import WebSocket from 'ws'

const PAIR_COOKIE = 'pipiui_pair'
const HEX32_RE = /^[0-9a-f]{64}$/
const ROOM_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProbeSocket = {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener?(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void
  removeEventListener?(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void
  on?(type: string, listener: (...args: any[]) => void): void
  off?(type: string, listener: (...args: any[]) => void): void
}

export type RemoteLinkProbeInput = {
  origin: string
  roomID: string
  pairSecret: string
  /**
   * Relay `POST /pair/:room/claim` with the *correct* secret always
   * `forgetGrant` + `replaceBrowser`. Callers must not pass a live user's
   * room here when a browser is already attached. Wrong secrets and expired
   * rooms return 403 *before* that mutation, so those probes are safe.
   */
  fetchImpl?: typeof fetch
  connectBrowser?: (url: string, cookie: string) => ProbeSocket
  timeoutMs?: number
  signal?: AbortSignal
  /** Fired after a 204 claim, before the browser `/ws` upgrade. */
  onClaimed?: () => void
}

export type RemoteLinkProbeResult =
  | { ok: true }
  | { ok: false; reason: string }

export function browserWsUrl(origin: string): string {
  const url = new URL(origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function pairCookieHeader(setCookie: string | null): string | null {
  if (!setCookie) return null
  const match = new RegExp(`${PAIR_COOKIE}=([^;]+)`).exec(setCookie)
  return match ? `${PAIR_COOKIE}=${match[1]}` : null
}

function fail(reason: string): RemoteLinkProbeResult {
  return { ok: false, reason }
}

function isAbort(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: string }).name === 'AbortError'
  )
}

function decodeSocketPayload(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (raw && typeof raw === 'object') {
    const record = raw as { data?: unknown }
    if (typeof record.data === 'string') return record.data
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(record.data)) return record.data.toString('utf8')
    if (record.data instanceof ArrayBuffer) return Buffer.from(record.data).toString('utf8')
    if (ArrayBuffer.isView(record.data)) return Buffer.from(record.data.buffer).toString('utf8')
  }
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer).toString('utf8')
  return String(raw)
}

function listen(
  socket: ProbeSocket,
  type: string,
  listener: (...args: any[]) => void
): () => void {
  if (socket.on && socket.off) {
    socket.on(type, listener)
    return () => socket.off?.(type, listener)
  }
  socket.addEventListener?.(type as 'open', listener)
  return () => socket.removeEventListener?.(type as 'open', listener)
}

function closeSocket(socket: ProbeSocket): void {
  if (socket.readyState >= 2) return
  try { socket.close(1000, 'link check') } catch { /* already closed */ }
}

function waitOpen(socket: ProbeSocket, signal: AbortSignal): Promise<void> {
  if (socket.readyState === 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const stopOpen = listen(socket, 'open', () => finish(undefined))
    const stopError = listen(socket, 'error', () => finish(new Error('ws error')))
    const stopClose = listen(socket, 'close', () => finish(new Error('ws closed')))
    const onAbort = () => finish(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const finish = (error?: Error) => {
      stopOpen()
      stopError()
      stopClose()
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function waitCapabilities(socket: ProbeSocket, requestId: string, signal: AbortSignal): Promise<RemoteLinkProbeResult> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(fail('连接超时'))
      return
    }
    const stopMessage = listen(socket, 'message', (event: { data?: unknown } | string) => {
      const text = decodeSocketPayload(
        typeof event === 'string' || (typeof Buffer !== 'undefined' && Buffer.isBuffer(event))
          ? event
          : event && typeof event === 'object' && 'data' in event
            ? event.data
            : event
      )
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { return }
      if (!parsed || typeof parsed !== 'object') return
      const value = parsed as Record<string, unknown>
      if (value.v === 2) {
        if (value.type === 'error' && value.reason === 'host_offline') {
          finish(fail('Host 未连接'))
        }
        return
      }
      if (value.type === 'response' && value.id === requestId) {
        finish(value.ok === true ? { ok: true } : fail('协议往返失败'))
      }
    })
    const stopClose = listen(socket, 'close', () => finish(fail('浏览器通道已断开')))
    const stopError = listen(socket, 'error', () => finish(fail('浏览器通道无法建立')))
    const onAbort = () => finish(fail('连接超时'))
    const finish = (result: RemoteLinkProbeResult) => {
      stopMessage()
      stopClose()
      stopError()
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      socket.send(JSON.stringify({
        protocolVersion: 2,
        id: requestId,
        type: 'request',
        method: 'capabilities',
        params: []
      }))
    } catch {
      finish(fail('浏览器通道无法建立'))
    }
  })
}

export function defaultConnectBrowser(url: string, cookie: string): ProbeSocket {
  return new WebSocket(url, { headers: { Cookie: cookie } }) as unknown as ProbeSocket
}

/**
 * Prove the pair URL's claim → cookie → browser `/ws` → Host request path.
 *
 * This is intentionally more than `GET /healthz` or `GET /pair/:room`.
 * It POSTs `/pair/:room/claim` with the given secret, upgrades `/ws` with
 * the grant cookie, and expects a `capabilities` response.
 *
 * Do not point this at a room that already has a real browser: Relay claim
 * replaces the current grant and browser. The remote-control service skips
 * this probe while status is `paired` and only runs it when the host is
 * `ready` (no browser). Pair secrets themselves are reusable; the minted
 * probe grant is discarded on the next real user claim.
 */
export async function probeRemotePairLink(input: RemoteLinkProbeInput): Promise<RemoteLinkProbeResult> {
  if (!ROOM_ID_RE.test(input.roomID) || !HEX32_RE.test(input.pairSecret)) {
    return fail('链接已过期或配对密钥错误')
  }
  const timeoutMs = input.timeoutMs ?? 8_000
  const fetchImpl = input.fetchImpl ?? fetch
  const connectBrowser = input.connectBrowser ?? defaultConnectBrowser
  const origin = input.origin.replace(/\/$/, '')
  const claimUrl = `${origin}/pair/${input.roomID}/claim`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onOuterAbort, { once: true })

  let socket: ProbeSocket | null = null
  try {
    let claimed: Response
    try {
      claimed = await fetchImpl(claimUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: input.pairSecret }),
        signal: controller.signal
      })
    } catch (error) {
      return fail(isAbort(error) ? '连接超时' : 'Relay 不可达')
    }

    if (claimed.status === 403 || claimed.status === 404) {
      return fail('链接已过期或配对密钥错误')
    }
    if (claimed.status !== 204) {
      return fail(`配对认领失败（HTTP ${claimed.status}）`)
    }

    const cookie = pairCookieHeader(claimed.headers.get('set-cookie'))
    if (!cookie) return fail('配对认领未返回凭据')
    input.onClaimed?.()

    try {
      socket = connectBrowser(browserWsUrl(origin), cookie)
      await waitOpen(socket, controller.signal)
    } catch (error) {
      return fail(isAbort(error) ? '连接超时' : '浏览器通道无法建立')
    }

    return await waitCapabilities(socket, 'link-check', controller.signal)
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onOuterAbort)
    if (socket) closeSocket(socket)
  }
}
