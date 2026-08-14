import { useState } from 'react'

export type UserMessageImage = { data: string; mimeType: string }

/** Trailing optimistic count, with or without a space before 张. */
const IMAGE_COUNT_PLACEHOLDER = / ?\[\d+\s*张图片\]$/

/** Swift-compatible collapse rule: count Unicode code points, never UTF-16 units. */
export function shouldCollapseMessage(text: string): boolean {
  return [...text].length > 1000 || text.split('\n').length > 5
}

/** A deterministic preview for a collapsed user message, without an ellipsis. */
export function messagePreview(text: string, maxLines = 5, maxChars = 400): string {
  const firstLines = text.split('\n').slice(0, Math.max(0, maxLines)).join('\n')
  return [...firstLines].slice(0, Math.max(0, maxChars)).join('')
}

/** Drop `[N张图片]` / `[N 张图片]` once the real images are shown. */
export function displayUserMessageText(text: string, hasImages: boolean): string {
  if (!hasImages) return text
  return text.replace(IMAGE_COUNT_PLACEHOLDER, '')
}

export function userImageSrc(image: UserMessageImage): string {
  return `data:${image.mimeType};base64,${image.data}`
}

export function UserMessageBubble({ text, images }: { text: string; images?: UserMessageImage[] }) {
  const shownImages = images?.filter(image => image.data) ?? []
  const hasImages = shownImages.length > 0
  const visibleText = displayUserMessageText(text, hasImages)
  const collapsible = shouldCollapseMessage(visibleText)
  const [collapsed, setCollapsed] = useState(collapsible)
  const displayText = collapsible && collapsed ? messagePreview(visibleText) : visibleText

  return <div className="user-bubble">
    {hasImages && <div className="user-bubble-images">{shownImages.map((image, index) => <img key={index} className="user-bubble-image" src={userImageSrc(image)} alt="用户图片" />)}</div>}
    {collapsible && <button className="user-message-collapse-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开' : '收起'}</button>}
    {visibleText ? <div className="user-message-content">{displayText}</div> : null}
  </div>
}
