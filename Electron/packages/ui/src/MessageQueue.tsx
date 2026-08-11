import { useEffect, useState } from 'react'
import './message-queue.css'

/** Lifecycle of one queued follow-up (mirrors Swift session message queue). */
export type MessageQueueItemStatus = 'queued' | 'sending' | 'failed'

/** Composer-facing image attachment metadata used only for the thumbnail identifier. */
export interface MessageQueueImage {
  /** Thumbnail source (object URL / data URL) — renderer never loads full payloads. */
  url?: string
  /** Original file name when available. */
  name?: string
}

export interface MessageQueueItem {
  id: string
  text: string
  /** Optional image attachments; only count + thumbnail identifier are rendered. */
  images?: MessageQueueImage[]
  status: MessageQueueItemStatus
  /** Shown under the row when status === 'failed'. */
  error?: string
}

export interface MessageQueueProps {
  /** FIFO queue contents (array order = send order). Empty queue hides the strip. */
  items: MessageQueueItem[]
  /** Expand/collapse state is fully controlled by the parent. */
  expanded: boolean
  /** True while a queue operation is in flight — disables all mutating actions. */
  pending?: boolean
  /** Lease/read-only state: browsing remains available, but host queue mutations are disabled. */
  mutationsDisabled?: boolean
  onToggle: () => void
  /** Bring the item to the front of the queue ("插队"). */
  onPromote: (id: string) => void
  /** Persist an edited text for a queued item. */
  onEdit: (id: string, text: string) => void
  onRemove: (id: string) => void
  /** Re-send a failed item. */
  onRetry: (id: string) => void
  /** Dispatch a queued item immediately as a real host follow-up. */
  onSteer?: (id: string) => void
  /** Only available while the selected host session is busy. */
  canSteer?: boolean
}

const STATUS_LABEL: Record<MessageQueueItemStatus, string> = {
  queued: '排队中',
  sending: '发送中',
  failed: '发送失败'
}

/** Hard cap for summaries shown in the collapsed bar and list rows. */
export const MESSAGE_QUEUE_SUMMARY_MAX = 60

/**
 * Conservative markdown stripping for queue summaries (mirrors the rail's
 * `stripMarkdown`): strips fences, inline code, links/images, headings,
 * blockquotes, bullets, bold and strikethrough. Single `*`/`_` italics are
 * left alone so code-ish text like `foo_bar` is not mangled.
 */
function stripMarkdownForQueue(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
}

/**
 * Plain-text summary for a queued message: strips markdown, collapses
 * whitespace, truncates by code point. Standalone so the queue never depends
 * on transcript helpers.
 */
export function messageQueueSummary(text: string, maxLength = MESSAGE_QUEUE_SUMMARY_MAX): string {
  const collapsed = stripMarkdownForQueue(text ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  const chars = Array.from(collapsed)
  if (chars.length <= maxLength) return collapsed
  return chars.slice(0, maxLength).join('') + '…'
}

/**
 * Compact queue strip rendered above the composer (mirrors Swift `queueStrip`):
 * `排队 N 条` + first-item preview when collapsed, an expandable list with
 * per-item order, summary, image count/thumbnail identifier, status
 * (queued/sending/failed) and 插队 / 编辑 / 删除 / 重试 actions.
 *
 * Fully controlled — the parent owns items/expanded and all callbacks; the
 * component holds only transient inline-edit UI state (no host/localStorage).
 */
export function MessageQueue({
  items,
  expanded,
  pending = false,
  mutationsDisabled = false,
  onToggle,
  onPromote,
  onEdit,
  onRemove,
  onRetry,
  onSteer,
  canSteer = false
}: MessageQueueProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const mutationBlocked = pending || mutationsDisabled

  // Inline-edit draft is transient UI state; drop it if the parent removes the item.
  useEffect(() => {
    if (editing && !items.some(item => item.id === editing.id)) setEditing(null)
  }, [items, editing])

  if (items.length === 0) return null

  const first = items[0]
  const firstText = messageQueueSummary(first.text)
  const firstPreview = firstText || (first.images?.length ? `${first.images.length} 张图片` : '（空消息）')

  const startEdit = (item: MessageQueueItem) => setEditing({ id: item.id, text: item.text })
  const cancelEdit = () => setEditing(null)
  const commitEdit = () => {
    if (!editing || mutationBlocked || editing.text.trim() === '') return
    onEdit(editing.id, editing.text)
    setEditing(null)
  }
  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commitEdit()
    }
  }

  return (
    <section className="message-queue" data-testid="message-queue" aria-label="消息队列">
      <button
        type="button"
        className="message-queue__bar"
        data-testid="message-queue-toggle"
        aria-expanded={expanded}
        aria-controls="message-queue-list"
        onClick={onToggle}
      >
        <span className="message-queue__tray" aria-hidden="true">▤</span>
        <span className="message-queue__count" data-testid="message-queue-count">排队 {items.length} 条</span>
        <span className="message-queue__preview" data-testid="message-queue-preview" title={first.text}>{firstPreview}</span>
        <span className="message-queue__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <ul id="message-queue-list" className="message-queue__list" data-testid="message-queue-list">
          {items.map((item, index) => {
            const isEditing = editing?.id === item.id
            const text = messageQueueSummary(item.text)
            const imageCount = item.images?.length ?? 0
            return (
              <li
                key={item.id}
                className="message-queue__item"
                data-testid={`message-queue-item-${index}`}
                data-status={item.status}
              >
                <span className="message-queue__index" aria-hidden="true">{index + 1}</span>

                <span className="message-queue__body">
                  {isEditing ? (
                    <span className="message-queue__editor" data-testid={`queue-editor-${index}`}>
                      <textarea
                        className="message-queue__editor-input"
                        aria-label={`编辑第 ${index + 1} 条消息`}
                        value={editing.text}
                        rows={2}
                        disabled={mutationBlocked}
                        onChange={event => setEditing(current => current ? { ...current, text: event.target.value } : current)}
                        onKeyDown={onEditorKeyDown}
                        data-testid={`queue-editor-input-${index}`}
                      />
                      <span className="message-queue__editor-actions">
                        <button
                          type="button"
                          className="message-queue__save"
                          data-testid="queue-save"
                          disabled={mutationBlocked || editing.text.trim() === ''}
                          onClick={commitEdit}
                        >
                          保存
                        </button>
                        <button type="button" className="message-queue__cancel" data-testid="queue-cancel" onClick={cancelEdit}>
                          取消
                        </button>
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="message-queue__text" data-testid={`queue-text-${index}`}>{text}</span>
                      {imageCount > 0 && (
                        <span className="message-queue__thumbs" data-testid={`queue-thumbs-${index}`}>
                          {item.images!.slice(0, 3).map((image, thumbIndex) =>
                            image.url ? (
                              <img
                                key={thumbIndex}
                                className="message-queue__thumb"
                                src={image.url}
                                alt=""
                                aria-hidden="true"
                              />
                            ) : (
                              <span key={thumbIndex} className="message-queue__thumb message-queue__thumb--blank" aria-hidden="true" />
                            )
                          )}
                          <span className="message-queue__thumb-count" aria-label={`${imageCount} 张图片`}>{imageCount}</span>
                        </span>
                      )}
                      {item.status === 'failed' && item.error && (
                        <span className="message-queue__error" data-testid={`queue-error-${index}`} role="alert">{item.error}</span>
                      )}
                    </>
                  )}
                </span>

                {!isEditing && (
                  <>
                    <span
                      className={`message-queue__status message-queue__status--${item.status}`}
                      data-testid={`queue-status-${index}`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span className="message-queue__actions">
                      {item.status === 'failed' && (
                        <button
                          type="button"
                          className="message-queue__retry"
                          data-testid={`queue-retry-${index}`}
                          aria-label={`重试第 ${index + 1} 条`}
                          disabled={mutationBlocked}
                          onClick={() => onRetry(item.id)}
                        >
                          重试
                        </button>
                      )}
                      {onSteer && canSteer && item.status === 'queued' && (
                        <button
                          type="button"
                          className="message-queue__steer"
                          data-testid={`queue-steer-${index}`}
                          aria-label={`立即发送第 ${index + 1} 条`}
                          disabled={mutationBlocked}
                          onClick={() => onSteer(item.id)}
                        >
                          立即发送
                        </button>
                      )}
                      <button
                        type="button"
                        className="message-queue__promote"
                        data-testid={`queue-promote-${index}`}
                        aria-label={`插队第 ${index + 1} 条`}
                        title={index === 0 ? '已是队首' : '插队到最前'}
                        disabled={mutationBlocked || item.status === 'sending' || index === 0}
                        onClick={() => onPromote(item.id)}
                      >
                        插队
                      </button>
                      <button
                        type="button"
                        className="message-queue__edit"
                        data-testid={`queue-edit-${index}`}
                        aria-label={`编辑第 ${index + 1} 条`}
                        disabled={mutationBlocked || item.status === 'sending'}
                        onClick={() => startEdit(item)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="message-queue__remove"
                        data-testid={`queue-remove-${index}`}
                        aria-label={`删除第 ${index + 1} 条`}
                        disabled={mutationBlocked || item.status === 'sending'}
                        onClick={() => onRemove(item.id)}
                      >
                        删除
                      </button>
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
