import { useEffect, useMemo, useState } from 'react'
import './computer-use.css'
import { qrSvg } from './pair-qr'

export type RemoteControlStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'paired'
  | 'reconnecting'
  | 'stopped'
  | 'error'

export type RemoteControlState = {
  enabled: boolean
  status: RemoteControlStatus
  pairUrl: string | null
  roomID: string | null
  relayOrigin: string | null
  hostEpoch: number | null
  generation: number | null
  error?: string
  debugEnabled?: boolean
  debugUrl?: string | null
  debugError?: string
}

export type PipiRemoteControlAPI = {
  invoke(command: { type: string; relayOrigin?: string }): Promise<RemoteControlState>
  getState(): Promise<RemoteControlState>
  start(relayOrigin?: string): Promise<RemoteControlState>
  stop(): Promise<RemoteControlState>
  reset(relayOrigin?: string): Promise<RemoteControlState>
  startDebug?: () => Promise<RemoteControlState>
  stopDebug?: () => Promise<RemoteControlState>
  subscribe(listener: (state: RemoteControlState) => void): () => void
}

const IDLE: RemoteControlState = {
  enabled: false,
  status: 'idle',
  pairUrl: null,
  roomID: null,
  relayOrigin: null,
  hostEpoch: null,
  generation: null
}

export const REMOTE_SELF_HOST_LESSON_KEY = 'pipiui.remoteSelfHostLesson'
export const REMOTE_SELF_HOST_LESSON_DISMISSED = 'dismissed'
export const DEFAULT_RELAY_ORIGIN = 'https://remote.deepwood.cn'
export const REMOTE_SELF_HOST_PROMPT =
  '我想自己搭建远程链接服务器。请按仓库 Relay/README.md 和 skill self-host-relay，先问我云服务器的 SSH 登录方式和域名，再把 Relay 和 browser-ui 传上去配好 HTTPS。完成后告诉我在「远程控制」里填哪个 https 地址。不要用 remote.deepwood.cn。'

export function statusLabel(status: RemoteControlStatus): string {
  switch (status) {
    case 'connecting':
      return '连接中'
    case 'ready':
      return '已连接 Relay'
    case 'paired':
      return '浏览器已连接'
    case 'reconnecting':
      return '断线重连中'
    case 'error':
      return '出错'
    case 'idle':
    case 'stopped':
    default:
      return '未开启'
  }
}

export function remoteControlFromWindow(win: Window & { pipiRemoteControl?: PipiRemoteControlAPI } = window): PipiRemoteControlAPI | null {
  const api = win.pipiRemoteControl
  if (!api || typeof api.getState !== 'function' || typeof api.start !== 'function' || typeof api.stop !== 'function') return null
  return api
}

export function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function lessonWasDismissed(): boolean {
  try {
    return localStorage.getItem(REMOTE_SELF_HOST_LESSON_KEY) === REMOTE_SELF_HOST_LESSON_DISMISSED
  } catch {
    return false
  }
}

function persistLessonDismissed(): void {
  try {
    localStorage.setItem(REMOTE_SELF_HOST_LESSON_KEY, REMOTE_SELF_HOST_LESSON_DISMISSED)
  } catch {
    /* ignore quota / private mode */
  }
}

export function RemoteConnectionPanel({
  onClose,
  onAskPipiui,
  onOpenDebugUrl,
  remoteControl,
  hysteresisMs,
}: {
  onClose: () => void
  onAskPipiui?: (prompt: string) => void
  onOpenDebugUrl?: (url: string) => void
  remoteControl?: PipiRemoteControlAPI | null
  hysteresisMs?: number
}) {
  const api = remoteControl === undefined ? remoteControlFromWindow() : remoteControl
  const [state, setState] = useState<RemoteControlState>(IDLE)
  const [shownStatus, setShownStatus] = useState<RemoteControlStatus>(IDLE.status)
  const [loading, setLoading] = useState(Boolean(api))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [originDraft, setOriginDraft] = useState(DEFAULT_RELAY_ORIGIN)
  const [lessonOpen, setLessonOpen] = useState(false)

  useEffect(() => {
    if (!api) {
      setLoading(false)
      return
    }
    let active = true
    void api.getState().then(next => {
      if (active) {
        setState(next)
        if (next.relayOrigin) setOriginDraft(next.relayOrigin)
      }
    }).catch(err => {
      if (active) setError(`读取状态失败：${err instanceof Error ? err.message : String(err)}`)
    }).finally(() => {
      if (active) setLoading(false)
    })
    const unsubscribe = api.subscribe?.(next => {
      if (active) {
        setState(next)
        if (next.relayOrigin) setOriginDraft(next.relayOrigin)
      }
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [api])

  useEffect(() => {
    const next = state.status
    if (next === 'ready' || next === 'paired' || next === 'connecting' || next === 'idle' || next === 'stopped') {
      setShownStatus(next)
      return
    }
    if (next === 'reconnecting' && shownStatus !== 'ready' && shownStatus !== 'paired') {
      setShownStatus('reconnecting')
      return
    }
    const id = window.setTimeout(() => {
      setShownStatus(next === 'error' && shownStatus === 'reconnecting' ? 'reconnecting' : next)
    }, hysteresisMs ?? 2_000)
    return () => window.clearTimeout(id)
  }, [state.status, shownStatus])

  const qr = useMemo(() => {
    if (!state.pairUrl) return null
    try {
      return qrSvg(state.pairUrl)
    } catch {
      return null
    }
  }, [state.pairUrl])

  const dismissLesson = () => {
    persistLessonDismissed()
    setLessonOpen(false)
  }

  const askPipiuiToSelfHost = () => {
    persistLessonDismissed()
    setLessonOpen(false)
    onAskPipiui?.(REMOTE_SELF_HOST_PROMPT)
  }

  const toggle = async () => {
    if (!api || busy) return
    setBusy(true)
    setError(null)
    try {
      const origin = isHttpOrigin(originDraft) ? originDraft.trim() : undefined
      const next = state.enabled ? await api.stop() : await api.start(origin)
      setState(next)
    } catch (err) {
      setError(`${state.enabled ? '关闭' : '开启'}失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const applyOrigin = async () => {
    if (!api || busy) return
    const origin = originDraft.trim()
    if (!isHttpOrigin(origin)) {
      setError('请填写以 http:// 或 https:// 开头的服务器地址')
      return
    }
    if (state.enabled) {
      const ok = window.confirm('更换服务器后旧链接失效，确定？')
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      const next = state.enabled ? await api.reset(origin) : await api.start(origin)
      setState(next)
    } catch (err) {
      setError(`应用服务器地址失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!state.pairUrl) return
    try {
      await navigator.clipboard.writeText(state.pairUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (err) {
      setError(`复制失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const openDebugUrl = (url?: string | null) => {
    if (!url) return
    try {
      onOpenDebugUrl?.(url)
    } catch {
      /* no selected session / host — URL stays visible */
    }
  }

  const toggleDebug = async () => {
    if (!api?.startDebug || !api.stopDebug || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = state.debugEnabled ? await api.stopDebug() : await api.startDebug()
      setState(next)
      if (!state.debugEnabled && next.debugEnabled && next.debugUrl) openDebugUrl(next.debugUrl)
    } catch (err) {
      setError(`${state.debugEnabled ? '关闭' : '开启'} Debug 失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    if (!api || busy) return
    const ok = window.confirm('重新生成后旧链接将失效，确定继续？')
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      setState(await api.reset())
    } catch (err) {
      setError(`重新生成失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-modal-backdrop" data-testid="remote-connection-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal remote-connection-panel" role="dialog" aria-modal="true" aria-label="远程控制" data-testid="remote-connection-panel">
        <header className="settings-modal-header">
          <div>
            <h2>远程控制</h2>
            <p>通过配对链接或二维码连接浏览器。</p>
          </div>
          <button className="settings-modal-close" aria-label="关闭远程控制" onClick={onClose}>×</button>
        </header>
        {!api ? (
          <div className="settings-modal-empty">当前连接未提供远程配对能力</div>
        ) : loading ? (
          <div className="settings-modal-empty">正在加载远程控制…</div>
        ) : (
          <div className="settings-modal-body computer-use-body">
            <div className="remote-origin-row">
              <label className="remote-pair-label" htmlFor="remote-relay-origin">服务器地址</label>
              <div className="remote-origin-fields">
                <input
                  id="remote-relay-origin"
                  className="remote-origin-input"
                  data-testid="remote-relay-origin"
                  value={originDraft}
                  onChange={event => setOriginDraft(event.target.value)}
                  placeholder={DEFAULT_RELAY_ORIGIN}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="button" aria-label="应用服务器地址" disabled={busy} onClick={() => void applyOrigin()}>应用</button>
              </div>
            </div>
            <div className="computer-use-toggle-row">
              <div>
                <strong>开启远程控制</strong>
                <p data-testid="remote-control-status">{statusLabel(shownStatus)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.enabled}
                aria-label="开启远程控制"
                className={`computer-use-switch${state.enabled ? ' enabled' : ''}`}
                disabled={busy}
                onClick={() => void toggle()}
              >
                <span />
              </button>
            </div>
            {api.startDebug && api.stopDebug && (
              <div className="computer-use-toggle-row" data-testid="remote-debug-block">
                <div>
                  <strong>本地 Debug 模式</strong>
                  <p data-testid="remote-debug-status">{state.debugEnabled ? '已开启' : '未开启'}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(state.debugEnabled)}
                  aria-label="本地 Debug 模式"
                  className={`computer-use-switch${state.debugEnabled ? ' enabled' : ''}`}
                  disabled={busy}
                  onClick={() => void toggleDebug()}
                >
                  <span />
                </button>
              </div>
            )}
            {state.debugUrl && (
              <div className="remote-pair-block" data-testid="remote-debug-url-block">
                <label className="remote-pair-label" htmlFor="remote-debug-url">本地界面</label>
                <code id="remote-debug-url" className="remote-pair-url" data-testid="remote-debug-url">{state.debugUrl}</code>
                <div className="remote-pair-actions">
                  <button type="button" aria-label="打开本地界面" onClick={() => openDebugUrl(state.debugUrl)}>打开本地界面</button>
                </div>
              </div>
            )}
            {state.debugError && <div className="settings-modal-error" role="alert" data-testid="remote-debug-error">{state.debugError}</div>}
            <button type="button" className="remote-lesson-reopen" onClick={() => setLessonOpen(true)}>用自己的网站搭建</button>
            {state.status === 'ready' && <p className="computer-use-description">已连上 Relay，等待浏览器扫描或打开配对链接。</p>}
            {state.pairUrl && (
              <div className="remote-pair-block">
                {qr && (
                  <div
                    className="remote-pair-qr"
                    data-testid="remote-pair-qr"
                    aria-label="配对二维码"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                )}
                <label className="remote-pair-label" htmlFor="remote-pair-url">配对链接</label>
                <code id="remote-pair-url" className="remote-pair-url" data-testid="remote-pair-url">{state.pairUrl}</code>
                <div className="remote-pair-actions">
                  <button type="button" aria-label="复制配对链接" onClick={() => void copyLink()}>{copied ? '已复制' : '复制链接'}</button>
                  <button type="button" aria-label="重新生成链接" disabled={busy} onClick={() => void regenerate()}>重新生成链接</button>
                </div>
              </div>
            )}
            {state.error && <div className="settings-modal-error" role="alert">{state.error}</div>}
            {error && <div className="settings-modal-error" role="alert">{error}</div>}
          </div>
        )}
        {lessonOpen && (
          <div className="remote-lesson-overlay" data-testid="remote-self-host-lesson" role="dialog" aria-labelledby="remote-lesson-title">
            <div className="remote-lesson-card">
              <h2 id="remote-lesson-title">用自己的网站也能远程控制</h2>
              <p>现在可以用官方服务器，打开开关就能配对。</p>
              <p>若要用<strong>自己的网站</strong>，不必自己会部署：点「让 PipiUI 帮我搭建」，在聊天里告诉它云服务器怎么登录、域名是什么。</p>
              <p>需要事先有：一台能 SSH 的云服务器 + 一条指到它的域名。</p>
              <p>搭好后把 <code>https://你的域名</code> 填进「服务器地址」。</p>
              <div className="remote-lesson-actions">
                <button type="button" className="remote-lesson-primary" onClick={askPipiuiToSelfHost}>让 PipiUI 帮我搭建</button>
                <button type="button" className="remote-lesson-secondary" onClick={dismissLesson}>先用现在的服务器</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
