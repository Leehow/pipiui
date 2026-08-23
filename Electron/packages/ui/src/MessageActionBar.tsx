import type { ReactNode } from 'react'
import copyIcon from './sf-icons/doc-on-doc.png'
import resendIcon from './sf-icons/arrow-clockwise.png'

export type MessageActionBarProps = {
  alignment: 'leading' | 'trailing'
  canCopy: boolean
  canResend?: boolean
  canJump?: boolean
  copyDisabled?: boolean
  resendDisabled?: boolean
  onCopy: () => void
  onResend?: () => void
  onJump?: () => void
  copied?: boolean
}

function JumpGlyph() {
  return (
    <svg className="message-action-icon-svg" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MessageActionButton({ label, title, icon, disabled, onClick, children }: {
  label: string
  title: string
  icon?: string
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
}) {
  return (
    <button className="message-action-button" type="button" aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      {icon
        ? <span className="message-action-icon" style={{ WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})` }} aria-hidden="true" />
        : children}
    </button>
  )
}

export function MessageActionBar({ alignment, canCopy, canResend = false, canJump = false, copyDisabled = false, resendDisabled = false, onCopy, onResend, onJump, copied = false }: MessageActionBarProps) {
  if (!canCopy && !canResend && !canJump) return null

  return <div className={`message-action-bar ${alignment}`} role="toolbar" aria-label="消息操作">
    <div className="message-action-buttons">
      {canCopy && <MessageActionButton label="复制消息" title="复制" icon={copyIcon} disabled={copyDisabled} onClick={onCopy} />}
      {canJump && <MessageActionButton label="跳转到上一条用户消息" title="跳转到上一条用户消息" onClick={onJump}><JumpGlyph /></MessageActionButton>}
      {canResend && <MessageActionButton label="重发消息" title="重发（撤回后重新发送）" icon={resendIcon} disabled={resendDisabled} onClick={onResend} />}
    </div>
    {copied && <span className="message-copied-notice" role="status">已复制</span>}
  </div>
}
