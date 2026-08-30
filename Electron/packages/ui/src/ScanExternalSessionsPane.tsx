import type { ScanExternalSessionsController } from './useScanExternalSessions'

/** Host-owned pane for the `external-session-scan` builtin; nested under 扩展. */
export function ScanExternalSessionsPane({ scan }: { scan: ScanExternalSessionsController }) {
  if (!scan.available) {
    return <div className="model-modal-state" data-testid="scan-external-unsupported">当前连接不支持外部会话扫描设置。</div>
  }
  if (scan.loading) {
    return <div className="model-modal-state" data-testid="scan-external-loading">正在加载外部会话扫描设置…</div>
  }
  return (
    <div className="vision-picker" data-testid="scan-external-pane">
      <div className="computer-use-toggle-row">
        <div>
          <strong>自动扫描其他 coding agent 聊天记录</strong>
          <p>关闭后侧栏不再显示 Codex / Claude / Cursor 等外部会话。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={scan.enabled}
          aria-label="自动扫描其他 coding agent 聊天记录"
          className={`computer-use-switch${scan.enabled ? ' enabled' : ''}`}
          disabled={scan.saving}
          data-testid="scan-external-sessions-switch"
          onClick={() => void scan.setEnabled(!scan.enabled)}
        >
          <span />
        </button>
      </div>
      {scan.error && (
        <div className="model-modal-error" role="alert" data-testid="scan-external-error">
          <span>{scan.error}</span>
          <button className="visibility-error-close" aria-label="关闭错误提示" data-testid="scan-external-error-close" onClick={() => scan.dismissError()}>×</button>
        </div>
      )}
    </div>
  )
}
