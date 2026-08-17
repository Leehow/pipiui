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
}

export type PipiRemoteControlAPI = {
  invoke(command: { type: string; relayOrigin?: string }): Promise<RemoteControlState>
  getState(): Promise<RemoteControlState>
  start(relayOrigin?: string): Promise<RemoteControlState>
  stop(): Promise<RemoteControlState>
  reset(relayOrigin?: string): Promise<RemoteControlState>
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

export function statusLabel(status: RemoteControlStatus): string {
  switch (status) {
    case 'connecting':
      return '连接中'
    case 'ready':
      return '已连接 Relay'
    case 'paired':
      return '等待浏览器配对'
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

export function RemoteConnectionPanel({
  onClose,
  remoteControl
}: {
  onClose: () => void
  remoteControl?: PipiRemoteControlAPI | null
}) {
  const api = remoteControl === undefined ? remoteControlFromWindow() : remoteControl
  const [state, setState] = useState<RemoteControlState>(IDLE)
  const [loading, setLoading] = useState(Boolean(api))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!api) {
      setLoading(false)
      return
    }
    let active = true
    void api.getState().then(next => {
      if (active) setState(next)
    }).catch(err => {
      if (active) setError(`读取状态失败：${err instanceof Error ? err.message : String(err)}`)
    }).finally(() => {
      if (active) setLoading(false)
    })
    const unsubscribe = api.subscribe?.(next => {
      if (active) setState(next)
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [api])

  const qr = useMemo(() => {
    if (!state.pairUrl) return null
    try {
      return qrSvg(state.pairUrl)
    } catch {
      return null
    }
  }, [state.pairUrl])

  const toggle = async () => {
    if (!api || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = state.enabled ? await api.stop() : await api.start()
      setState(next)
    } catch (err) {
      setError(`${state.enabled ? '关闭' : '开启'}失败：${err instanceof Error ? err.message : String(err)}`)
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
            <div className="computer-use-toggle-row">
              <div>
                <strong>开启远程控制</strong>
                <p data-testid="remote-control-status">{statusLabel(state.status)}</p>
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
            {state.status === 'ready' && <p className="computer-use-description">已连上 Relay，等待浏览器扫描或打开配对链接。</p>}
            {state.pairUrl && (
              <div className="remote-pair-block">
                <label className="remote-pair-label" htmlFor="remote-pair-url">配对链接</label>
                <code id="remote-pair-url" className="remote-pair-url" data-testid="remote-pair-url">{state.pairUrl}</code>
                <div className="remote-pair-actions">
                  <button type="button" aria-label="复制配对链接" onClick={() => void copyLink()}>{copied ? '已复制' : '复制链接'}</button>
                  <button type="button" aria-label="重新生成链接" disabled={busy} onClick={() => void regenerate()}>重新生成链接</button>
                </div>
                {qr && (
                  <div
                    className="remote-pair-qr"
                    data-testid="remote-pair-qr"
                    aria-label="配对二维码"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                )}
              </div>
            )}
            {state.error && <div className="settings-modal-error" role="alert">{state.error}</div>}
            {error && <div className="settings-modal-error" role="alert">{error}</div>}
          </div>
        )}
      </section>
    </div>
  )
}
