import { useState } from 'react'

/** Swift-compatible collapse rule: count Unicode code points, never UTF-16 units. */
export function shouldCollapseMessage(text: string): boolean {
  return [...text].length > 1000 || text.split('\n').length > 5
}

/** A deterministic preview for a collapsed user message, without an ellipsis. */
export function messagePreview(text: string, maxLines = 5, maxChars = 400): string {
  const firstLines = text.split('\n').slice(0, Math.max(0, maxLines)).join('\n')
  return [...firstLines].slice(0, Math.max(0, maxChars)).join('')
}

export function UserMessageBubble({ text }: { text: string }) {
  const collapsible = shouldCollapseMessage(text)
  const [collapsed, setCollapsed] = useState(collapsible)
  const displayText = collapsible && collapsed ? messagePreview(text) : text

  return <div className="user-bubble">
    {collapsible && <button className="user-message-collapse-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开' : '收起'}</button>}
    <div className="user-message-content">{displayText}</div>
  </div>
}
