export const PAIR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const PAIR_SECRET_RE = /^[0-9a-f]{64}$/

export type RemotePhase = 'pairing' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export type RemoteCloseKind = 'replaced' | 'expired' | 'host_offline' | 'auth' | 'transient' | 'unknown'

export type RemoteCloseCopy = {
  kind: RemoteCloseKind
  title: string
  detail: string
  action: string
  reconnect: boolean
}

const PAIR_PATH_RE =
  /^\/pair\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export const REMOTE_PAIR_STORAGE_KEY = 'pipiui:remote-pair'

export type StoredRemotePair = { pairID: string; secret: string }

export function readStoredRemotePair(storage?: Pick<Storage, 'getItem'> | null): StoredRemotePair | null {
  try {
    const raw = (storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null))?.getItem(REMOTE_PAIR_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredRemotePair>
    if (typeof parsed.pairID !== 'string' || typeof parsed.secret !== 'string') return null
    if (!PAIR_ID_RE.test(parsed.pairID) || !PAIR_SECRET_RE.test(parsed.secret)) return null
    return { pairID: parsed.pairID.toLowerCase(), secret: parsed.secret.toLowerCase() }
  } catch {
    return null
  }
}

export function writeStoredRemotePair(pair: StoredRemotePair, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    ;(storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null))?.setItem(
      REMOTE_PAIR_STORAGE_KEY,
      JSON.stringify({ pairID: pair.pairID.toLowerCase(), secret: pair.secret.toLowerCase() }),
    )
  } catch {
    // sessionStorage may be unavailable (privacy mode / non-browser); degrade to cookie-only.
  }
}

export function parsePairLocation(pathname: string, hash = ''): { pairID: string; secret: string } | { error: string } | null {
  const match = PAIR_PATH_RE.exec(pathname)
  if (!match) return null
  const pairID = match[1].toLowerCase()
  const secret = hash.startsWith('#') ? hash.slice(1) : hash
  if (!PAIR_SECRET_RE.test(secret)) return { error: '链接无效或密钥缺失；请使用完整配对链接。' }
  return { pairID, secret: secret.toLowerCase() }
}

export function classifyRemoteClose(input: { code?: number; reason?: string; controlType?: string } = {}): RemoteCloseKind {
  const reason = (input.reason ?? '').toLowerCase()
  const control = (input.controlType ?? '').toLowerCase()
  const code = input.code ?? 0
  if (control === 'replaced' || reason.includes('replaced')) return 'replaced'
  if (control === 'expired' || reason.includes('expired') || reason.includes('link expired')) return 'expired'
  if (control === 'end' || reason.includes('host ended') || reason.includes('host offline')) return 'host_offline'
  if (
    reason.includes('pairing required')
    || reason.includes('unauthorized')
    || reason.includes('pairing rejected')
    || reason.includes('auth')
    || reason.includes('401')
    || code === 4003
    || code === 401
  ) return 'auth'
  if (code === 4001 && (reason.includes('pair') || reason.includes('required'))) return 'auth'
  if (code === 4001 && reason.includes('expired')) return 'expired'
  if (code === 4001) return 'replaced'
  if (code === 1000 || code === 1001 || code === 1006 || code === 1011 || code === 1012 || code === 1013) return 'transient'
  return 'unknown'
}

export function remoteCloseCopy(kind: RemoteCloseKind): RemoteCloseCopy {
  switch (kind) {
    case 'replaced':
      return {
        kind,
        title: '已在别处打开',
        detail: '同一配对链接在另一浏览器打开，当前页面已断开。若要继续使用本页，可重新接管（会断开另一浏览器）。',
        action: '重新接管',
        reconnect: false,
      }
    case 'expired':
      return {
        kind,
        title: '房间已过期',
        detail: '配对房间超过有效期或链接已被吊销，远程会话已结束。请在桌面端重新生成二维码。',
        action: '返回桌面端重新配对',
        reconnect: false,
      }
    case 'host_offline':
      return {
        kind,
        title: '主机已离线',
        detail: '桌面端 PipiUI 未在线或已结束远程会话。确认主机已打开后再重试。',
        action: '主机上线后重试',
        reconnect: true,
      }
    case 'auth':
      return {
        kind,
        title: '鉴权失败',
        detail: '配对凭证无效或已失效。请使用完整配对链接重新打开，不要去掉 # 后的密钥。',
        action: '使用完整配对链接重试',
        reconnect: false,
      }
    case 'transient':
    case 'unknown':
      return {
        kind,
        title: '连接已断开',
        detail: '网络中断或主机暂时不可达。正在尝试自动重连，已发出的消息不会自动重发。',
        action: '立即重试',
        reconnect: true,
      }
  }
}

export function nextReconnectDelayMs(attempt: number): number {
  const n = Math.max(0, attempt)
  return Math.min(16_000, 500 * 2 ** n)
}

export function phaseLabel(phase: RemotePhase): string {
  switch (phase) {
    case 'pairing': return '正在配对…'
    case 'connecting': return '正在连接主机…'
    case 'connected': return '已连接'
    case 'reconnecting': return '正在重新连接…'
    case 'disconnected': return '已断开'
  }
}

export function readControlType(raw: unknown): string | undefined {
  let value = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return undefined }
  } else if (raw && typeof raw === 'object' && 'data' in raw) {
    const data = (raw as { data?: unknown }).data
    if (typeof data === 'string') {
      try { value = JSON.parse(data) } catch { return undefined }
    } else {
      value = data
    }
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as { v?: unknown; type?: unknown }
  if (record.v !== 2 || typeof record.type !== 'string') return undefined
  return record.type
}
