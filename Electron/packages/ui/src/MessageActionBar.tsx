export type MessageActionBarProps = {
  alignment: 'leading' | 'trailing'
  canCopy: boolean
  canResend?: boolean
  copyDisabled?: boolean
  resendDisabled?: boolean
  onCopy: () => void
  onResend?: () => void
  copied?: boolean
}

export function MessageActionBar({ alignment, canCopy, canResend = false, copyDisabled = false, resendDisabled = false, onCopy, onResend, copied = false }: MessageActionBarProps) {
  if (!canCopy && !canResend) return null

  return <div className={`message-action-bar ${alignment}`} role="toolbar" aria-label="消息操作">
    <div className="message-action-buttons">
      {canCopy && <button className="message-action-button" aria-label="复制消息" title="复制" disabled={copyDisabled} onClick={onCopy}>⎘</button>}
      {canResend && <button className="message-action-button" aria-label="重发消息" title="重发（撤回后重新发送）" disabled={resendDisabled} onClick={onResend}>↻</button>}
    </div>
    {copied && <span className="message-copied-notice" role="status">已复制</span>}
  </div>
}
