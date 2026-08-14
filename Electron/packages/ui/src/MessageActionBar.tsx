import copyIcon from './sf-icons/doc-on-doc.png'
import resendIcon from './sf-icons/arrow-clockwise.png'

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

function MessageActionButton({ label, title, icon, disabled, onClick }: {
  label: string
  title: string
  icon: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button className="message-action-button" type="button" aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      <span className="message-action-icon" style={{ WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})` }} aria-hidden="true" />
    </button>
  )
}

export function MessageActionBar({ alignment, canCopy, canResend = false, copyDisabled = false, resendDisabled = false, onCopy, onResend, copied = false }: MessageActionBarProps) {
  if (!canCopy && !canResend) return null

  return <div className={`message-action-bar ${alignment}`} role="toolbar" aria-label="消息操作">
    <div className="message-action-buttons">
      {canCopy && <MessageActionButton label="复制消息" title="复制" icon={copyIcon} disabled={copyDisabled} onClick={onCopy} />}
      {canResend && <MessageActionButton label="重发消息" title="重发（撤回后重新发送）" icon={resendIcon} disabled={resendDisabled} onClick={onResend} />}
    </div>
    {copied && <span className="message-copied-notice" role="status">已复制</span>}
  </div>
}
