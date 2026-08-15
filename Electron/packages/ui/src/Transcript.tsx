import { forwardRef, memo, useEffect, useMemo, useState } from 'react'
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

export type MessageActionHandlers = { onCopy: (message: ChatMessage) => Promise<void>; onResend: (message: ChatMessage) => void; resendDisabled: boolean; copiedId: string | null }
type DocumentOpenProps = { documentBasePath?: string; onOpenDocument?: (path: string) => void }
type SubagentOpenProps = { onOpenSubagents?: (agentId?: string) => void }

export function Transcript({ messages, transcriptRef, waiting, documentBasePath, onOpenDocument, onOpenSubagents, onCopy, onResend, resendDisabled, copiedId }: {
  messages: ChatMessage[]
  transcriptRef: React.RefObject<VirtuosoHandle>
  waiting?: { startedAt: number; phase: WaitingPhase; detail?: string; onStop?: () => void }
} & DocumentOpenProps & SubagentOpenProps & MessageActionHandlers) {
  const [atBottom, setAtBottom] = useState(true)
  const [seekingId, setSeekingId] = useState<string | null>(null)
  const prompts = useMemo(() => buildRailPrompts(messages), [messages])
  const { activeId: viewportActiveId, containerRef } = useActivePromptId(prompts, atBottom)
  const activeId = seekingId ?? viewportActiveId
  useEffect(() => { if (atBottom) setSeekingId(null) }, [atBottom])
  const jump = (index: number, id: string) => { setSeekingId(id); transcriptRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' }) }
  const returnLatest = () => { setSeekingId(null); transcriptRef.current?.scrollToIndex({ index: Math.max(0, messages.length - 1), align: 'end', behavior: 'smooth' }); setAtBottom(true) }
  return <div className={waiting ? 'transcript-area is-waiting' : 'transcript-area'} ref={containerRef}>
    <PromptRail prompts={prompts} activeId={activeId} onJump={jump} />
    <MessageList ref={transcriptRef} messages={messages} atBottom={atBottom} onAtBottom={setAtBottom} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} onOpenSubagents={onOpenSubagents} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copiedId={copiedId} />
    {waiting && <WaitingPlaceholder phase={waiting.phase} startedAt={waiting.startedAt} detail={waiting.detail} onStop={waiting.onStop} />}
    {!atBottom && messages.length > 0 && <button className="return-latest" aria-label="回到最新" title="回到最新" onClick={returnLatest}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
  </div>
}

export const MessageList = memo(forwardRef<VirtuosoHandle, { messages: ChatMessage[]; atBottom: boolean; onAtBottom: (value: boolean) => void } & DocumentOpenProps & SubagentOpenProps & MessageActionHandlers>(function MessageList({ messages, atBottom, onAtBottom, documentBasePath, onOpenDocument, onOpenSubagents, onCopy, onResend, resendDisabled, copiedId }, ref) {
  return <div className="message-list" data-testid="message-scroll"><Virtuoso ref={ref} data={messages} followOutput={() => atBottom ? 'auto' : false} atBottomStateChange={onAtBottom} alignToBottom itemContent={(index, message) => { const next = messages[index + 1]; const isTurnEnd = message.role === 'user' || (!message.streaming && (!next || next.role !== 'assistant')); return <MessageView message={message} showFooter={isTurnEnd} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} onOpenSubagents={onOpenSubagents} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copied={copiedId === message.id} /> }} /></div>
}))

function messageTime(timestamp?: number): string { if (!timestamp) return ''; const date = new Date(timestamp); const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` }

export const MessageView = memo(function MessageView({ message, showFooter, documentBasePath, onOpenDocument, onOpenSubagents, onCopy, onResend, resendDisabled, copied }: { message: ChatMessage; showFooter?: boolean; copied?: boolean } & DocumentOpenProps & SubagentOpenProps & Omit<MessageActionHandlers, 'copiedId'>) {
  const signal = message.role === 'user' ? parseSubagentSignal(message.content) : null
  const copyDisabled = !message.content.trim()
  const copy = () => { void onCopy(message).catch(() => undefined) }
  const time = showFooter && message.timestamp ? <time className="message-time" dateTime={new Date(message.timestamp).toISOString()}>{messageTime(message.timestamp)}</time> : null
  const actions = showFooter && !signal ? <MessageActionBar alignment="trailing" canCopy canResend={message.role === 'user' && Boolean(message.content.trim())} copyDisabled={copyDisabled} resendDisabled={resendDisabled} onCopy={copy} onResend={() => onResend(message)} copied={copied} /> : null
  const footer = actions || time ? <div className="message-footer">{time}{actions}</div> : null
  if (message.role === 'user') return signal ? <article className="message user-message subagent-signal-message"><div className="subagent-signal-stack"><SubagentSignalCard content={message.content} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} />{time}</div></article> : <article className="message user-message" data-user-prompt={message.id}><div className="user-message-stack"><UserMessageBubble text={message.content} images={message.images} /></div>{footer}</article>
  if (message.role === 'tool') { const notice = parseSubagentNotice(message.content); return notice ? <article className="message assistant-message"><CollapsibleActivityCard kind="result" label="子任务" summary={notice.name} meta={`${notice.ok ? '成功' : '失败'} · ${notice.cost}`} error={!notice.ok}><pre><TruncatedText text={message.content} /></pre></CollapsibleActivityCard>{footer}</article> : <article className="system-message tool-message"><div><TruncatedText text={message.content} /></div>{footer}</article> }
  return <article className="message assistant-message"><AssistantTranscriptContent message={message} onOpenSubagents={onOpenSubagents} documentBasePath={documentBasePath} onOpenDocument={onOpenDocument} />{footer}</article>
})
