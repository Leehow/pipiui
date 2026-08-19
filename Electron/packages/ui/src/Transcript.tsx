import { forwardRef, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { ActivityCard as CollapsibleActivityCard } from './ActivityCard'
import { AssistantTranscriptContent } from './AssistantTranscriptContent'
import { MessageActionBar } from './MessageActionBar'
import { PromptRail, useActivePromptId } from './PromptRail'
import { SubagentSignalCard } from './SubagentSignalCard'
import { UserMessageBubble } from './UserMessageBubble'
import { WaitingPlaceholder, type WaitingPhase } from './WaitingPlaceholder'
import { buildRailPrompts } from './prompt-rail'
import { parseSubagentNotice } from './subagent-notice'
import { parseSubagentSignal } from './subagent-signal'
import { TruncatedText } from './TruncatedText'
import type { ChatMessage } from './transcript-model'
import { nextTranscriptFirstItemIndex, TRANSCRIPT_FIRST_ITEM_BASE, TRANSCRIPT_PIN_MAX_ATTEMPTS, transcriptDataIndex, transcriptMessageIdentity } from './transcript-scroll'

export type MessageActionHandlers = { onCopy: (message: ChatMessage) => Promise<void>; onResend: (message: ChatMessage) => void; resendDisabled: boolean; copiedId: string | null }
type DocumentOpenProps = { documentBasePath?: string; onOpenDocument?: (path: string) => void }
type SubagentOpenProps = { onOpenSubagents?: (agentId?: string) => void }

function transcriptItemKey(index: number, message: ChatMessage) {
  return `${index}:${message.id}`
}

function assignVirtuosoRef(ref: React.RefObject<VirtuosoHandle> | undefined, value: VirtuosoHandle | null) {
  if (ref) (ref as React.MutableRefObject<VirtuosoHandle | null>).current = value
}

export function Transcript({ messages, transcriptRef, waiting, active = true, documentBasePath, onOpenDocument, onOpenSubagents, onCopy, onResend, resendDisabled, copiedId }: {
  messages: ChatMessage[]
  /** Optional bridge for the active slot. Every Transcript still owns its handle. */
  transcriptRef?: React.RefObject<VirtuosoHandle>
  waiting?: { startedAt: number; phase: WaitingPhase; detail?: string; onStop?: () => void }
  active?: boolean
} & DocumentOpenProps & SubagentOpenProps & MessageActionHandlers) {
  const [atBottom, setAtBottom] = useState(true)
  const [seekingId, setSeekingId] = useState<string | null>(null)
  const activeRef = useRef(active)
  const atBottomRef = useRef(true)
  const followIntentRef = useRef(true)
  const userDetachedRef = useRef(false)
  const userDetachedSawAwayRef = useRef(false)
  const pendingPinRef = useRef(false)
  const pinGenerationRef = useRef(0)
  const pinIssuedGenerationRef = useRef(-1)
  const pinAttemptsRef = useRef(0)
  const pinFrameRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  activeRef.current = active

  const clearPinFrame = useCallback(() => {
    if (pinFrameRef.current !== null) cancelAnimationFrame(pinFrameRef.current)
    pinFrameRef.current = null
    pinAttemptsRef.current = 0
  }, [])
  const requestPin = useCallback(() => {
    if (!activeRef.current || !followIntentRef.current) return
    pinGenerationRef.current += 1
    pinIssuedGenerationRef.current = -1
    pendingPinRef.current = true
    pinAttemptsRef.current = 0
    if (pinFrameRef.current !== null) return
    const attempt = () => {
      pinFrameRef.current = null
      if (!activeRef.current || !followIntentRef.current || !pendingPinRef.current) return
      const generation = pinGenerationRef.current
      const handle = virtuosoRef.current
      if (handle) {
        // Mark before invoking Virtuoso because a test double (or a future
        // synchronous implementation) may report atBottom from this call.
        pinIssuedGenerationRef.current = generation
        handle.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
      }
      pinAttemptsRef.current += 1
      if (pendingPinRef.current && pinAttemptsRef.current < TRANSCRIPT_PIN_MAX_ATTEMPTS) {
        pinFrameRef.current = requestAnimationFrame(attempt)
      }
    }
    pinFrameRef.current = requestAnimationFrame(attempt)
  }, [])
  const cancelFollow = useCallback(() => {
    if (!activeRef.current) return
    followIntentRef.current = false
    userDetachedRef.current = true
    userDetachedSawAwayRef.current = !atBottomRef.current
    pendingPinRef.current = false
    clearPinFrame()
    setAtBottom(false)
  }, [clearPinFrame])
  const setVirtuosoHandle = useCallback((handle: VirtuosoHandle | null) => {
    const previous = virtuosoRef.current
    virtuosoRef.current = handle
    if (!transcriptRef || !activeRef.current) return
    if (handle) assignVirtuosoRef(transcriptRef, handle)
    else if (transcriptRef.current === previous) assignVirtuosoRef(transcriptRef, null)
  }, [transcriptRef])

  const prompts = useMemo(() => buildRailPrompts(messages), [messages])
  const { activeId: viewportActiveId, containerRef } = useActivePromptId(prompts, atBottom)
  const activeId = seekingId ?? viewportActiveId
  useEffect(() => { if (atBottom) setSeekingId(null) }, [atBottom])
  useLayoutEffect(() => {
    if (!active) {
      pendingPinRef.current = false
      clearPinFrame()
      return
    }
    followIntentRef.current = true
    userDetachedRef.current = false
    userDetachedSawAwayRef.current = false
    setSeekingId(null)
    requestPin()
  }, [active, clearPinFrame, requestPin])
  useLayoutEffect(() => {
    if (active && followIntentRef.current) requestPin()
  }, [active, messages, requestPin])
  useLayoutEffect(() => {
    if (!active || !transcriptRef) return
    const handle = virtuosoRef.current
    assignVirtuosoRef(transcriptRef, handle)
    return () => {
      if (transcriptRef.current === handle) assignVirtuosoRef(transcriptRef, null)
    }
  }, [active, transcriptRef])
  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let width = -1
    let height = -1
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width === width && entry.contentRect.height === height) continue
        width = entry.contentRect.width
        height = entry.contentRect.height
        requestPin()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [containerRef, requestPin])
  useEffect(() => () => clearPinFrame(), [clearPinFrame])

  const handleAtBottom = (value: boolean) => {
    if (!activeRef.current) return
    atBottomRef.current = value
    if (!value) {
      if (userDetachedRef.current) userDetachedSawAwayRef.current = true
      setAtBottom(false)
      return
    }
    // A hidden slot can replay an old true before the activation RAF runs.
    // Only a true after this generation actually issued LAST may finish it.
    if (pendingPinRef.current && pinIssuedGenerationRef.current !== pinGenerationRef.current) return
    // Ignore a stale true delivered between the upward gesture and Virtuoso's
    // first measured-away callback. A later false→true is a real return.
    if (userDetachedRef.current && !userDetachedSawAwayRef.current) return
    userDetachedRef.current = false
    userDetachedSawAwayRef.current = false
    setAtBottom(true)
    followIntentRef.current = true
    pendingPinRef.current = false
    clearPinFrame()
  }
  const jump = (index: number, id: string) => {
    cancelFollow()
    setSeekingId(id)
    virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' })
  }
  const returnLatest = () => {
    followIntentRef.current = true
    userDetachedRef.current = false
    userDetachedSawAwayRef.current = false
    setSeekingId(null)
    requestPin()
  }
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) cancelFollow()
  }
  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    const start = touchStartRef.current
    if (!touch || !start) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (deltaY >= 14 && deltaY > Math.abs(deltaX)) cancelFollow()
  }
  return <div className={waiting ? 'transcript-area is-waiting' : 'transcript-area'} ref={containerRef} onWheelCapture={handleWheel} onTouchStartCapture={handleTouchStart} onTouchMoveCapture={handleTouchMove}>
    <PromptRail prompts={prompts} activeId={activeId} onJump={jump} />
    <MessageList ref={setVirtuosoHandle} messages={messages} active={active} shouldFollow={() => followIntentRef.current} onAtBottom={handleAtBottom} onListHeightChanged={requestPin} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} onOpenSubagents={onOpenSubagents} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copiedId={copiedId} />
    {waiting && <WaitingPlaceholder phase={waiting.phase} startedAt={waiting.startedAt} detail={waiting.detail} onStop={waiting.onStop} />}
    {active && !atBottom && messages.length > 0 && <button className="return-latest" aria-label="回到最新" title="回到最新" onClick={returnLatest}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
  </div>
}

export const MessageList = memo(forwardRef<VirtuosoHandle, { messages: ChatMessage[]; active?: boolean; shouldFollow: () => boolean; onAtBottom: (value: boolean) => void; onListHeightChanged: () => void } & DocumentOpenProps & SubagentOpenProps & MessageActionHandlers>(function MessageList({ messages, active = true, shouldFollow, onAtBottom, onListHeightChanged, documentBasePath, onOpenDocument, onOpenSubagents, onCopy, onResend, resendDisabled, copiedId }, ref) {
  const ids = useMemo(() => messages.map(transcriptMessageIdentity), [messages])
  const previousIdsRef = useRef<readonly string[]>([])
  const firstItemIndexRef = useRef(TRANSCRIPT_FIRST_ITEM_BASE)
  const firstItemIndex = nextTranscriptFirstItemIndex(firstItemIndexRef.current, previousIdsRef.current, ids)
  firstItemIndexRef.current = firstItemIndex
  previousIdsRef.current = ids
  return <div className="message-list" data-testid="message-scroll"><Virtuoso
    ref={ref}
    data={messages}
    firstItemIndex={firstItemIndex}
    computeItemKey={transcriptItemKey}
    initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
    followOutput={() => active && shouldFollow() ? 'auto' : false}
    atBottomStateChange={onAtBottom}
    totalListHeightChanged={onListHeightChanged}
    alignToBottom
    itemContent={(index, message) => {
      const dataIndex = transcriptDataIndex(index, firstItemIndex)
      const next = messages[dataIndex + 1]
      const isTurnEnd = message.role === 'user' || (!message.streaming && (!next || next.role !== 'assistant'))
      return <MessageView message={message} showFooter={isTurnEnd} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} onOpenSubagents={onOpenSubagents} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copied={copiedId === message.id} />
    }}
  /></div>
}))

function messageTime(timestamp?: number): string { if (!timestamp) return ''; const date = new Date(timestamp); const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` }

export const MessageView = memo(function MessageView({ message, showFooter, documentBasePath, onOpenDocument, onOpenSubagents, onCopy, onResend, resendDisabled, copied }: { message: ChatMessage; showFooter?: boolean; copied?: boolean } & DocumentOpenProps & SubagentOpenProps & Omit<MessageActionHandlers, 'copiedId'>) {
  const signal = message.role === 'user' ? parseSubagentSignal(message.content) : null
  const copyDisabled = !message.content.trim()
  const copy = () => { void onCopy(message).catch(() => undefined) }
  const time = showFooter && message.timestamp ? <time className="message-time" dateTime={new Date(message.timestamp).toISOString()}>{messageTime(message.timestamp)}</time> : null
  const actions = showFooter && !signal ? <MessageActionBar alignment="trailing" canCopy canResend={message.role === 'user' && Boolean(message.content.trim())} copyDisabled={copyDisabled} resendDisabled={resendDisabled} onCopy={copy} onResend={() => onResend(message)} copied={copied} /> : null
  const footer = actions || time ? <div className="message-footer">{time}{actions}</div> : null
  if (message.role === 'compaction') return <CompactionDivider message={message} />
  if (message.role === 'user') return signal ? <article className="message user-message subagent-signal-message"><div className="subagent-signal-stack"><SubagentSignalCard content={message.content} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} />{time}</div></article> : <article className="message user-message" data-user-prompt={message.id}><div className="user-message-stack"><UserMessageBubble text={message.content} images={message.images} /></div>{footer}</article>
  if (message.role === 'tool') { const notice = parseSubagentNotice(message.content); return notice ? <article className="message assistant-message"><CollapsibleActivityCard kind="result" label="子任务" summary={notice.name} meta={`${notice.ok ? '成功' : '失败'} · ${notice.cost}`} error={!notice.ok}><pre><TruncatedText text={message.content} /></pre></CollapsibleActivityCard>{footer}</article> : <article className="system-message tool-message"><div><TruncatedText text={message.content} /></div>{footer}</article> }
  return <article className="message assistant-message"><AssistantTranscriptContent message={message} onOpenSubagents={onOpenSubagents} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} />{footer}</article>
})

export function CompactionDivider({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const summary = message.content.trim()
  return (
    <div className="compaction-divider" data-testid="compaction-divider" data-compaction-id={message.id}>
      <div className="compaction-divider-rule" aria-hidden="true" />
      <button type="button" className="compaction-divider-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        上下文已压缩
        <span className="compaction-divider-hint">{open ? '收起摘要' : '查看摘要'}</span>
      </button>
      {open && <div className="compaction-divider-summary" data-testid="compaction-summary">{summary || '本次压缩未留下摘要。'}</div>}
    </div>
  )
}
