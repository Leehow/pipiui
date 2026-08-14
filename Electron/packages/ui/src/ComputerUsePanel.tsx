import { useEffect, useState } from 'react'
import type { ComputerUsePermissionKind, ComputerUseState, PipiHostAPI } from '@pipi/host-api'
import './computer-use.css'

/** Electron parity for Swift's compact ComputerUseSettingsPanel. */
export function ComputerUsePanel({ host, onClose }: { host: PipiHostAPI; onClose: () => void }) {
  const hostMethodsPresent = typeof host.getComputerUseState === 'function' && typeof host.setComputerUseEnabled === 'function'
  const [available, setAvailable] = useState(hostMethodsPresent)
  const [state, setState] = useState<ComputerUseState>({ enabled: false })
  const [loading, setLoading] = useState(hostMethodsPresent)
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState<ComputerUsePermissionKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!host.getComputerUseState) return
    let active = true
    const load = (markUnavailableOnError = false) => {
      void host.getComputerUseState!().then(next => {
        if (active) setState(next)
      }).catch(() => {
        // IPC factories expose optional methods optimistically; an older backend
        // replies “unknown method”, which is an unavailable settings surface.
        if (active && markUnavailableOnError) setAvailable(false)
      }).finally(() => { if (active) setLoading(false) })
    }
    load(true)
    const timer = window.setInterval(() => load(false), 2000)
    return () => { active = false; window.clearInterval(timer) }
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

  const openPermission = async (kind: ComputerUsePermissionKind) => {
    if (!host.openComputerUsePermission || opening) return
    setOpening(kind)
    setError(null)
    try {
      setState(await host.openComputerUsePermission(kind))
    } catch (err) {
      setError(`打开系统设置失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setOpening(null)
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
              <PermissionRow title="屏幕录制" kind="screenRecording" granted={state.screenRecording} opening={opening === 'screenRecording'} onOpen={host.openComputerUsePermission ? openPermission : undefined} />
              <PermissionRow title="辅助功能" kind="accessibility" granted={state.accessibility} opening={opening === 'accessibility'} onOpen={host.openComputerUsePermission ? openPermission : undefined} />
            </div>
            {error && <div className="settings-modal-error" role="alert">{error}</div>}
          </div>
        )}
      </section>
    </div>
  )
}

function PermissionRow({ title, kind, granted, opening, onOpen }: { title: string; kind: ComputerUsePermissionKind; granted?: boolean; opening: boolean; onOpen?: (kind: ComputerUsePermissionKind) => void }) {
  const known = granted !== undefined
  const allowed = granted === true
  const canOpen = typeof onOpen === 'function'
  const actionLabel = allowed ? `打开${title}设置` : `去授权${title}`
  return (
    <div className="computer-use-permission-row">
      <span className={`computer-use-permission-status ${allowed ? 'granted' : known ? 'denied' : 'unknown'}`} aria-label={`${title}${allowed ? '已授权' : known ? '未授权' : '状态未提供'}`}>
        {allowed ? '✓' : known ? '✗' : '—'}
      </span>
      <span>{title}</span>
      <span className="computer-use-permission-label">{allowed ? '已授权' : known ? '未授权' : '未提供'}</span>
      <button
        type="button"
        aria-label={actionLabel}
        disabled={!canOpen || opening}
        title={canOpen ? (allowed ? '打开系统设置' : '打开系统设置并请求授权') : (known ? '当前连接不能打开系统权限设置' : '当前连接未提供权限状态')}
        onClick={() => onOpen?.(kind)}
      >
        {allowed ? '设置' : '去授权'}
      </button>
    </div>
  )
}
