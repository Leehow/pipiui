import { useEffect, useState } from 'react'
import type { PipiHostAPI } from '@pipi/host-api'
import './computer-use.css'

type ComputerState = { enabled: boolean; screenRecording?: boolean; accessibility?: boolean }

/** Electron parity for Swift's compact ComputerUseSettingsPanel. */
export function ComputerUsePanel({ host, onClose }: { host: PipiHostAPI; onClose: () => void }) {
  const hostMethodsPresent = typeof host.getComputerUseState === 'function' && typeof host.setComputerUseEnabled === 'function'
  const [available, setAvailable] = useState(hostMethodsPresent)
  const [state, setState] = useState<ComputerState>({ enabled: false })
  const [loading, setLoading] = useState(hostMethodsPresent)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host.getComputerUseState) return
    let active = true
    void host.getComputerUseState().then(next => {
      if (active) setState(next)
    }).catch(() => {
      // IPC factories expose optional methods optimistically; an older backend
      // replies “unknown method”, which is an unavailable settings surface.
      if (active) setAvailable(false)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [host])

  const toggle = async () => {
    if (!host.setComputerUseEnabled || saving) return
    const enabled = !state.enabled
    setSaving(true)
    setError(null)
    try {
      setState(current => ({ ...current, enabled }))
      const next = await host.setComputerUseEnabled(enabled)
      setState(current => ({ ...current, enabled: next.enabled }))
    } catch (err) {
      setState(current => ({ ...current, enabled: !enabled }))
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-modal-backdrop" data-testid="computer-use-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal computer-use-panel" role="dialog" aria-modal="true" aria-label="Computer Use（桌面控制）" data-testid="computer-use-panel">
        <header className="settings-modal-header">
          <div>
            <h2>Computer Use（桌面控制）</h2>
            <p>管理 Operator subagent 的桌面控制总开关。</p>
          </div>
          <button className="settings-modal-close" aria-label="关闭桌面控制" onClick={onClose}>×</button>
        </header>
        {!available ? (
          <div className="settings-modal-empty">当前连接不支持桌面控制设置。</div>
        ) : loading ? (
          <div className="settings-modal-empty">正在加载桌面控制设置…</div>
        ) : (
          <div className="settings-modal-body computer-use-body">
            <div className="computer-use-toggle-row">
              <div>
                <strong>启用 Computer Use</strong>
                <p>默认关闭。</p>
              </div>
              <button type="button" role="switch" aria-checked={state.enabled} aria-label="启用 Computer Use" className={`computer-use-switch${state.enabled ? ' enabled' : ''}`} disabled={saving} onClick={() => void toggle()}>
                <span />
              </button>
            </div>
            <p className="computer-use-description">打开后桌面工具只注入给带 desktop 授权的 subagent（operator）；主会话不持有 computer 工具。</p>
            <div className="computer-use-permissions" aria-label="桌面权限">
              <PermissionRow title="屏幕录制" granted={state.screenRecording} />
              <PermissionRow title="辅助功能" granted={state.accessibility} />
            </div>
            {error && <div className="settings-modal-error" role="alert">{error}</div>}
          </div>
        )}
      </section>
    </div>
  )
}

function PermissionRow({ title, granted }: { title: string; granted?: boolean }) {
  const known = granted !== undefined
  const allowed = granted === true
  return (
    <div className="computer-use-permission-row">
      <span className={`computer-use-permission-status ${allowed ? 'granted' : known ? 'denied' : 'unknown'}`} aria-label={`${title}${allowed ? '已授权' : known ? '未授权' : '状态未提供'}`}>
        {allowed ? '✓' : known ? '✗' : '—'}
      </span>
      <span>{title}</span>
      <span className="computer-use-permission-label">{allowed ? '已授权' : known ? '未授权' : '未提供'}</span>
      <button type="button" disabled={!known} title={known ? 'Electron 后端暂不能打开系统权限设置' : '当前连接未提供权限状态'}>{allowed ? '设置' : '去授权'}</button>
    </div>
  )
}
