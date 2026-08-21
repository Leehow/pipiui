import type { HistoryEntry, HistoryTool, StreamEvent } from '@pipi/host-api'
import { stripAttachmentPathsForDisplay } from './attachments'
import { displaySecretPlaceholders } from './secret-display'

export type TranscriptTool = {
  id: string
  name: string
  input: string
  result?: string
  error?: boolean
  startedAt: number
  finishedAt?: number
  finished?: boolean
  dispatched?: boolean
  images?: { data: string; mimeType: string }[]
}

export type TranscriptActivity =
  | { type: 'thinking'; id: string; contentIndex: number; segment?: number; content: string; charCount?: number }
  | { type: 'text'; id: string; contentIndex: number; segment?: number; content: string }
  | { type: 'tool'; contentIndex: number; segment?: number; tool: TranscriptTool }

/** Placeholder thinking activity opened after the last in-flight tool finishes.
 *  Providers that omit `thinking_delta` (openai-completions / Grok) otherwise
 *  leave a silent gap that the transcript paints as 已完成. */
export const PENDING_THINKING_ID = 'thinking:pending'

export type TranscriptSegment =
  | { type: 'steps'; activities: Array<Extract<TranscriptActivity, { type: 'thinking' | 'tool' }>> }
  | { type: 'text'; id: string; content: string }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'compaction'
  content: string
  thinking?: string
  tools?: TranscriptTool[]
  activities?: TranscriptActivity[]
  streaming?: boolean
  timestamp?: number
  images?: { data: string; mimeType: string }[]
  /** assistant only: terminal provider error (stopReason "error") rendered as an error bubble. */
  error?: string
  /** Local optimistic state for messages sent while queue is busy; cleared on host echo. */
  queued?: boolean
}

function isBackgroundSubagentAck(content: string): boolean {
  return /\bStarted background agent(?:\(s\)|s)?\b/i.test(content)
}

function cloneActivity(activity: TranscriptActivity, toolsById: Map<string, TranscriptTool>): TranscriptActivity {
  return activity.type === 'tool'
    ? { ...activity, tool: toolsById.get(activity.tool.id) ?? { ...activity.tool } }
    : { ...activity }
}

function mapHistoryActivity(entry: HistoryEntry, activity: NonNullable<HistoryEntry['activities']>[number], toolsById: Map<string, TranscriptTool>): TranscriptActivity {
  if (activity.type === 'thinking') return { type: 'thinking', id: `${entry.id}:${activity.contentIndex}`, contentIndex: activity.contentIndex, content: activity.content }
  if (activity.type === 'text') return { type: 'text', id: `${entry.id}:text:${activity.contentIndex}`, contentIndex: activity.contentIndex, content: activity.content }
  return { type: 'tool', contentIndex: activity.contentIndex, tool: toolsById.get(activity.tool.id) ?? { ...activity.tool, startedAt: entry.timestamp, finished: true } }
}

function lastSegment(activities: TranscriptActivity[]): number {
  return activities.reduce((highest, activity) => Math.max(highest, activity.segment ?? 0), 0)
}

function isPendingThinking(activity: TranscriptActivity | undefined): activity is Extract<TranscriptActivity, { type: 'thinking' }> {
  return activity?.type === 'thinking' && activity.id === PENDING_THINKING_ID && !activity.content
}

function stripPendingThinking(activities: TranscriptActivity[]): TranscriptActivity[] {
  return activities.filter(activity => !isPendingThinking(activity))
}

function allToolsFinished(tools: TranscriptTool[] | undefined): boolean {
  return (tools?.length ?? 0) > 0 && (tools ?? []).every(tool => Boolean(tool.finished))
}

function openPendingThinking(activities: TranscriptActivity[]): void {
  if (activities.some(isPendingThinking)) return
  const last = activities[activities.length - 1]
  if (last?.type === 'thinking') return
  activities.push({ type: 'thinking', id: PENDING_THINKING_ID, contentIndex: -1, content: '' })
}

export function activitiesFromMessage(message: Pick<ChatMessage, 'thinking' | 'tools' | 'activities'>): TranscriptActivity[] {
  return message.activities ?? [
    ...(message.thinking ? [{ type: 'thinking' as const, id: 'thinking', contentIndex: 0, content: message.thinking }] : []),
    ...(message.tools ?? []).map((tool, index) => ({ type: 'tool' as const, contentIndex: index + (message.thinking ? 1 : 0), tool })),
  ]
}

export function planTranscriptSegments(activities: TranscriptActivity[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let pending: Array<Extract<TranscriptActivity, { type: 'thinking' | 'tool' }>> = []
  const flush = () => {
    if (pending.length) {
      segments.push({ type: 'steps', activities: pending })
      pending = []
    }
  }
  for (const activity of activities) {
    if (activity.type === 'text') {
      if (!activity.content) continue
      flush()
      segments.push({ type: 'text', id: activity.id, content: activity.content })
    } else {
      pending.push(activity)
    }
  }
  flush()
  return segments
}

export function planAssistantTranscript(message: Pick<ChatMessage, 'content' | 'thinking' | 'tools' | 'activities'>): TranscriptSegment[] {
  const activities = activitiesFromMessage(message)
  const segments = planTranscriptSegments(activities)
  if (message.content && !activities.some(activity => activity.type === 'text')) {
    segments.push({ type: 'text', id: 'content', content: message.content })
  }
  return segments
}

/**
 * Normalize persisted transcript truth into the live activity shape. Agent
 * liveness is deliberately absent: a tool_result always completes the durable
 * tool record, while live children remain an independent presentation layer.
 */
function displayHistoryEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    content: displaySecretPlaceholders(entry.content),
    ...(entry.thinking ? { thinking: displaySecretPlaceholders(entry.thinking) } : {}),
    ...(entry.errorMessage ? { errorMessage: displaySecretPlaceholders(entry.errorMessage) } : {}),
    ...(entry.tools ? { tools: entry.tools.map(tool => ({ ...tool, input: displaySecretPlaceholders(tool.input) })) } : {}),
    ...(entry.activities ? {
      activities: entry.activities.map(activity => activity.type === 'tool'
        ? { ...activity, tool: { ...activity.tool, input: displaySecretPlaceholders(activity.tool.input) } }
        : { ...activity, content: displaySecretPlaceholders(activity.content) }),
    } : {}),
  }
}

export function historyMessages(entries: HistoryEntry[]): ChatMessage[] {
  const cards = new Map<string, TranscriptTool>()
  const messages: ChatMessage[] = []
  for (const entry of entries.map(displayHistoryEntry)) {
    if (entry.role === 'compaction') {
      messages.push({ id: entry.id, role: 'compaction', content: entry.content ?? '', timestamp: entry.timestamp })
      continue
    }
    if (entry.role === 'assistant' && (entry.thinking || entry.tools?.length || entry.activities?.some(activity => activity.type !== 'text'))) {
      const tools = entry.tools?.map(tool => ({ id: tool.id, name: tool.name, input: tool.input, startedAt: entry.timestamp, finished: true }))
      for (const tool of tools ?? []) cards.set(tool.id, tool)
      const toolsById = new Map((tools ?? []).map(tool => [tool.id, tool]))
      const activities: TranscriptActivity[] = entry.activities?.map(activity => mapHistoryActivity(entry, activity, toolsById)) ?? [
        ...(entry.thinking ? [{ type: 'thinking' as const, id: entry.id, contentIndex: 0, content: entry.thinking }] : []),
        ...(tools ?? []).map((tool, index) => ({ type: 'tool' as const, contentIndex: index + (entry.thinking ? 1 : 0), tool })),
      ]
      const previous = messages[messages.length - 1]
      if (previous?.role === 'assistant' && !previous.content && (previous.activities?.length ?? 0) > 0) {
        previous.activities!.push(...activities)
        previous.tools = [...(previous.tools ?? []), ...(tools ?? [])]
        previous.thinking ??= entry.thinking
        previous.content = entry.content
        previous.id = entry.id
        previous.timestamp = entry.timestamp
        continue
      }
      messages.push({ id: entry.id, role: 'assistant', content: entry.content, thinking: entry.thinking, tools, activities, timestamp: entry.timestamp, ...(entry.errorMessage ? { error: entry.errorMessage } : {}) })
      continue
    }
    if (entry.role === 'tool' && entry.toolCallId && cards.has(entry.toolCallId)) {
      const tool = cards.get(entry.toolCallId)!
      tool.result = entry.content
      tool.error = entry.isError
      tool.finishedAt = entry.timestamp
      tool.finished = true
      tool.dispatched = tool.name === 'subagent' && !tool.error && isBackgroundSubagentAck(entry.content)
      if (entry.images) tool.images = entry.images
      continue
    }
    const previous = messages[messages.length - 1]
    if (entry.role === 'assistant' && entry.content && previous?.role === 'assistant' && !previous.content && (previous.activities?.length ?? 0) > 0) {
      previous.content = entry.content
      previous.id = entry.id
      previous.timestamp = entry.timestamp
      continue
    }
    messages.push({ id: entry.id, role: entry.role, content: entry.role === 'user' ? stripAttachmentPathsForDisplay(entry.content) : entry.content, timestamp: entry.timestamp, ...(entry.role === 'assistant' && entry.errorMessage ? { error: entry.errorMessage } : {}), ...(entry.role === 'user' && entry.images?.length ? { images: entry.images } : {}) })
  }
  return messages
}

/** Stable persisted-transcript identity. It intentionally describes ordered
 *  message content/ids rather than ancestry by timestamp: branch and compaction
 *  snapshots may legitimately be shorter or carry equal/earlier timestamps. */
export function transcriptFingerprint(messages: readonly ChatMessage[]): string {
  return JSON.stringify(messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content,
    error: message.error,
    thinking: message.thinking,
    tools: message.tools?.map(tool => ({ id: tool.id, name: tool.name, input: tool.input, result: tool.result, error: tool.error })),
    activities: message.activities?.map(activity => activity.type === 'tool'
      ? { type: activity.type, contentIndex: activity.contentIndex, toolId: activity.tool.id, result: activity.tool.result, error: activity.tool.error }
      : { type: activity.type, contentIndex: activity.contentIndex, content: activity.content }),
    images: message.images?.map(image => ({ mimeType: image.mimeType, size: image.data.length })),
  })))
}

export function reconcileHistorySnapshot(
  entries: HistoryEntry[],
  requestLiveRevision: number,
  currentLiveRevision: number,
  previousFingerprint?: string,
  liveMessages?: readonly ChatMessage[],
): { status: 'accepted' | 'unchanged' | 'stale-request' | 'retained-longer-live'; messages: ChatMessage[]; fingerprint: string } {
  const messages = historyMessages(entries)
  const fingerprint = transcriptFingerprint(messages)
  if (requestLiveRevision !== currentLiveRevision) return { status: 'stale-request', messages, fingerprint }
  if (fingerprint === previousFingerprint) return { status: 'unchanged', messages, fingerprint }
  // Only block an empty first-page snapshot from wiping a non-empty live
  // transcript. Shorter non-empty history is a legitimate branch/retry.
  if (liveMessages && liveMessages.length > 0 && messages.length === 0) {
    return {
      status: 'retained-longer-live',
      messages: [...liveMessages],
      fingerprint: previousFingerprint ?? transcriptFingerprint(liveMessages),
    }
  }
  return { status: 'accepted', messages, fingerprint }
}

export type SecretRedactPatch = {
  id: string
  role?: ChatMessage['role']
  content: string
  thinking?: string
  tools?: HistoryTool[]
}

function applySecretRedactPatch(message: ChatMessage, patch: SecretRedactPatch): ChatMessage {
  const content = displaySecretPlaceholders(message.role === 'user' ? stripAttachmentPathsForDisplay(patch.content) : patch.content)
  const thinking = patch.thinking !== undefined ? displaySecretPlaceholders(patch.thinking) : message.thinking
  let tools = message.tools
  if (patch.tools && message.tools) {
    tools = message.tools.map(tool => {
      const nextTool = patch.tools!.find(item => item.id === tool.id)
      return nextTool ? { ...tool, input: displaySecretPlaceholders(nextTool.input) } : tool
    })
  }
  let activities = message.activities
  if (activities) {
    const oldJoined = activities.filter(activity => activity.type === 'text').map(activity => activity.content).join('')
    activities = activities.map((activity, index, items) => {
      if (activity.type === 'thinking' && patch.thinking !== undefined) {
        return { ...activity, content: displaySecretPlaceholders(patch.thinking) }
      }
      if (activity.type === 'text' && oldJoined && oldJoined !== content) {
        const first = items.findIndex(item => item.type === 'text') === index
        return first ? { ...activity, content } : { ...activity, content: '' }
      }
      if (activity.type === 'tool' && patch.tools) {
        const nextTool = patch.tools.find(item => item.id === activity.tool.id)
        return nextTool ? { ...activity, tool: { ...activity.tool, input: displaySecretPlaceholders(nextTool.input) } } : activity
      }
      return activity
    }).filter(activity => activity.type !== 'text' || activity.content)
  }
  if (message.content === content && message.thinking === thinking && tools === message.tools && activities === message.activities) return message
  return { ...message, content, thinking, tools, activities }
}

export function applySecretRedact(messages: ChatMessage[], patches: readonly SecretRedactPatch[]): ChatMessage[] {
  if (patches.length === 0) return messages
  const remaining = new Map(patches.map(patch => [patch.id, patch]))
  let changed = false
  const next = messages.map(message => {
    const patch = remaining.get(message.id)
    if (!patch) return message
    remaining.delete(message.id)
    const updated = applySecretRedactPatch(message, patch)
    if (updated !== message) changed = true
    return updated
  })
  if (remaining.size > 0) {
    const leftover = [...remaining.values()].find(patch => patch.role === 'user')
    const lastUserIndex = next.findLastIndex(message => message.role === 'user')
    if (leftover && lastUserIndex >= 0) {
      const updated = applySecretRedactPatch(next[lastUserIndex], leftover)
      if (updated !== next[lastUserIndex]) {
        next[lastUserIndex] = updated
        changed = true
      }
    }
  }
  return changed ? next : messages
}

export function appendLiveUserMessage(messages: ChatMessage[], incoming: { content: string; id?: string; images?: ChatMessage['images'] }, match?: { id: string; content: string }): ChatMessage[] {
  const raw = incoming.content
  if (!raw) return messages
  const content = displaySecretPlaceholders(stripAttachmentPathsForDisplay(raw))
  // Server echo of our own just-sent bubble: merge back into the optimistic
  // bubble by id — in place, so an assistant placeholder that already streamed
  // after it cannot wedge a duplicate below it.
  if (match && stripAttachmentPathsForDisplay(match.content).trim() === content.trim()) {
    const index = messages.findIndex(item => item.id === match.id)
    if (index >= 0) {
      const next = [...messages]
      const merged = { ...next[index], id: incoming.id ?? next[index].id, content, images: next[index].images?.length ? next[index].images : incoming.images }
      if (merged.queued) delete (merged as { queued?: boolean }).queued
      next[index] = merged
      return next
    }
  }
  // Also handle queued optimistic bubbles: find earliest queued user message
  // with matching content (FIFO queue drain order) and merge in place.
  const queuedIndex = messages.findIndex(item => item.role === 'user' && item.queued && stripAttachmentPathsForDisplay(item.content).trim() === content.trim())
  if (queuedIndex >= 0) {
    const next = [...messages]
    const queued = next[queuedIndex]
    const merged = { ...queued, id: incoming.id ?? queued.id, content, images: queued.images?.length ? queued.images : incoming.images }
    delete (merged as { queued?: boolean }).queued
    next[queuedIndex] = merged
    return next
  }
  const last = messages[messages.length - 1]
  if (last?.role === 'user' && last.content === raw) return messages
  if (last?.role === 'user' && stripAttachmentPathsForDisplay(last.content).trim() === content.trim()) {
    const next = [...messages]
    const merged = {
      ...last,
      id: incoming.id ?? last.id,
      content,
      images: last.images?.length ? last.images : incoming.images,
    }
    if ((merged as { queued?: boolean }).queued) delete (merged as { queued?: boolean }).queued
    next[next.length - 1] = merged
    return next
  }
  return [...messages, { id: incoming.id ?? `user-${Date.now()}`, role: 'user', content, timestamp: Date.now(), ...(incoming.images?.length ? { images: incoming.images } : {}) }]
}

export function applyStreamEvent(previous: ChatMessage[], event: Exclude<StreamEvent, { type: 'status' }>): ChatMessage[] {
  if (event.type === 'secret_redact') return applySecretRedact(previous, event.messages)
  if (event.type === 'error') return applyTurnError(previous, displaySecretPlaceholders(event.content))
  if (event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call') {
    if (event.delta) event = { ...event, delta: displaySecretPlaceholders(event.delta) }
  } else if (event.type === 'tool_result') {
    event = { ...event, content: displaySecretPlaceholders(event.content) }
  }
  if (event.type !== 'text' && event.type !== 'thinking' && event.type !== 'tool_call' && event.type !== 'tool_result') return previous
  const index = previous.findLastIndex(item => item.role === 'assistant')
  const current = index >= 0 && previous[index].streaming ? previous[index] : { id: `stream-${Date.now()}`, role: 'assistant' as const, content: '', thinking: '', tools: [], streaming: true, timestamp: Date.now() }
  const next = index >= 0 && previous[index].streaming ? [...previous] : [...previous, current]
  const tools = (current.tools ?? []).map(tool => ({ ...tool }))
  const toolsById = new Map(tools.map(tool => [tool.id, tool]))
  const activities = (current.activities ?? []).map(activity => cloneActivity(activity, toolsById))
  const updated: ChatMessage = { ...current, tools, activities }
  if (event.type === 'text') {
    updated.content += event.delta
    const pendingIndex = activities.findIndex(isPendingThinking)
    if (pendingIndex >= 0) activities.splice(pendingIndex, 1)
    const segment = event.segment ?? 0
    const id = `text:${segment}:${event.contentIndex}`
    const activityIndex = activities.findIndex(activity => activity.type === 'text' && activity.id === id)
    if (activityIndex >= 0) {
      const activity = activities[activityIndex]
      if (activity.type === 'text') activities[activityIndex] = { ...activity, content: activity.content + event.delta }
    } else {
      activities.push({ type: 'text', id, contentIndex: event.contentIndex, segment, content: event.delta })
    }
  }
  if (event.type === 'thinking') {
    updated.thinking = (updated.thinking ?? '') + event.delta
    // Pi restarts contentIndex at every assistant message, so the segment epoch
    // must be part of the key: same-index thinking from a later message is a
    // distinct block, not a continuation of the first one (history parity).
    const segment = event.segment ?? 0
    const pendingIndex = activities.findIndex(isPendingThinking)
    const activityIndex = pendingIndex >= 0
      ? pendingIndex
      : activities.findIndex(activity => activity.type === 'thinking' && activity.contentIndex === event.contentIndex && activity.id === `thinking:${segment}:${event.contentIndex}`)
    if (activityIndex >= 0) {
      const activity = activities[activityIndex]
      if (activity.type === 'thinking') {
        activities[activityIndex] = {
          ...activity,
          id: `thinking:${segment}:${event.contentIndex}`,
          contentIndex: event.contentIndex,
          segment,
          content: activity.id === PENDING_THINKING_ID ? event.delta : activity.content + event.delta,
        }
      }
    } else {
      activities.push({ type: 'thinking', id: `thinking:${segment}:${event.contentIndex}`, contentIndex: event.contentIndex, segment, content: event.delta })
    }
  }
  if (event.type === 'tool_call') {
    const pendingIndex = activities.findIndex(isPendingThinking)
    if (pendingIndex >= 0) activities.splice(pendingIndex, 1)
    const segment = event.segment ?? lastSegment(activities)
    let activityIndex = activities.findIndex(activity => activity.type === 'tool' && activity.tool.id === event.toolCallId)
    if (activityIndex < 0 && event.contentIndex !== undefined) {
      activityIndex = activities.findIndex(activity => activity.type === 'tool' && activity.contentIndex === event.contentIndex && (activity.segment ?? 0) === segment)
    }
    let toolIndex = activityIndex >= 0 && activities[activityIndex]?.type === 'tool'
      ? updated.tools!.findIndex(item => item.id === (activities[activityIndex] as Extract<TranscriptActivity, { type: 'tool' }>).tool.id)
      : updated.tools!.findIndex(item => item.id === event.toolCallId)
    if (toolIndex >= 0) {
      const previous = updated.tools![toolIndex]
      const remapping = previous.id !== event.toolCallId
      updated.tools![toolIndex] = {
        ...previous,
        id: event.toolCallId,
        name: event.name && event.name !== 'tool' ? event.name : previous.name,
        input: remapping && event.delta ? event.delta : previous.input + (event.delta ?? ''),
      }
    } else {
      updated.tools!.push({ id: event.toolCallId, name: event.name, input: event.delta ?? '', startedAt: Date.now() })
      toolIndex = updated.tools!.length - 1
    }
    const tool = updated.tools![toolIndex]
    if (activityIndex >= 0) activities[activityIndex] = { ...activities[activityIndex], tool } as TranscriptActivity
    else {
      const contentIndex = event.contentIndex ?? (activities.reduce((highest, activity) => Math.max(highest, activity.contentIndex), -1) + 1)
      activities.push({ type: 'tool', contentIndex, segment, tool })
    }
  }
  if (event.type === 'tool_result') {
    const toolIndex = updated.tools!.findIndex(item => item.id === event.toolCallId)
    if (toolIndex >= 0) {
      const tool = updated.tools![toolIndex]
      const completed = { ...tool, result: event.content, error: event.isError, finishedAt: Date.now(), finished: true, dispatched: tool.name === 'subagent' && !event.isError && isBackgroundSubagentAck(event.content), images: event.images }
      updated.tools![toolIndex] = completed
      const activityIndex = activities.findIndex(activity => activity.type === 'tool' && activity.tool.id === event.toolCallId)
      if (activityIndex >= 0) activities[activityIndex] = { ...activities[activityIndex], tool: completed } as TranscriptActivity
    }
    if (allToolsFinished(updated.tools)) openPendingThinking(activities)
  }
  // Keep insertion order. Sorting by contentIndex is wrong: Pi restarts the
  // index every assistant message, and text/thinking often share index 0.
  next[next.length - 1] = updated
  return next
}

/** A turn that ended in `stopReason: "error"` streams no text — surface the
 *  provider errorMessage on the assistant turn so the failure is visible
 *  instead of an empty bubble. */
function applyTurnError(messages: ChatMessage[], content: string): ChatMessage[] {
  if (!content) return messages
  const index = messages.findLastIndex(message => message.role === 'assistant' && message.streaming)
  const next = [...messages]
  if (index >= 0) {
    next[index] = { ...next[index], error: content, streaming: false }
  } else {
    next.push({ id: `error-${Date.now()}`, role: 'assistant', content: '', error: content, streaming: false, timestamp: Date.now() })
  }
  return next
}

export function finishStreamingMessage(messages: ChatMessage[]): ChatMessage[] {
  const index = messages.findLastIndex(message => message.role === 'assistant' && message.streaming)
  if (index < 0) return messages
  const next = [...messages]
  const message = next[index]
  const activities = message.activities ? stripPendingThinking(message.activities) : message.activities
  next[index] = { ...message, streaming: false, ...(activities ? { activities } : {}) }
  return next
}

/** Last durable activity is a finished tool (or the live pending-thinking
 *  placeholder). A later `started` after that is the next model hop, not a
 *  ghost turn after a text-only conclusion. */
export function assistantEndedAwaitingModel(message: Pick<ChatMessage, 'role' | 'content' | 'activities' | 'thinking' | 'tools'>): boolean {
  if (message.role !== 'assistant') return false
  const activities = activitiesFromMessage(message)
  let last: TranscriptActivity | undefined
  for (const activity of activities) {
    if (activity.type === 'text' && !activity.content) continue
    last = activity
  }
  if (!last) return false
  if (last.type === 'thinking') return last.id === PENDING_THINKING_ID
  if (last.type === 'text') return false
  if (last.type === 'tool' && last.tool.finished) {
    // Text-then-tools is a mid-turn hop. Tools plus `content` and no text
    // activity is a history-merged conclusion (the final prose never became
    // its own activity).
    if (activities.some(activity => activity.type === 'text' && activity.content)) return true
    return !message.content?.trim()
  }
  return false
}

/** JSONL/history conclusion: the assistant already produced readable text and
 *  is not sitting on a finished tool waiting for the next hop. Ignores
 *  `streaming` — a lost `settled` leaves that flag stuck true. */
export function assistantLooksSettled(message: Pick<ChatMessage, 'role' | 'content' | 'activities' | 'thinking' | 'tools' | 'error'>): boolean {
  if (message.role !== 'assistant') return false
  if (assistantEndedAwaitingModel(message)) return false
  const activities = activitiesFromMessage(message)
  if (activities.some(activity => activity.type === 'text' && activity.content.trim())) return true
  return Boolean(message.content?.trim() || message.error?.trim())
}

function historyMergedToolHop(message: Pick<ChatMessage, 'role' | 'content' | 'activities' | 'thinking' | 'tools'>): boolean {
  if (message.role !== 'assistant') return false
  const activities = activitiesFromMessage(message)
  let last: TranscriptActivity | undefined
  for (const activity of activities) {
    if (activity.type === 'text' && !activity.content) continue
    last = activity
  }
  return last?.type === 'tool' && Boolean(last.tool.finished)
}

/** Re-open the last tool-ended assistant so the next silent model hop still
 *  shows a live Thinking card instead of a pile of 已完成 steps. */
export function reopenAssistantForNextCompletion(
  messages: ChatMessage[],
  options?: { includeHistoryMergedToolHop?: boolean },
): ChatMessage[] {
  const index = messages.findLastIndex(message => message.role === 'assistant')
  if (index < 0) return messages
  const message = messages[index]
  if (!assistantEndedAwaitingModel(message) && !(options?.includeHistoryMergedToolHop && historyMergedToolHop(message))) {
    return messages
  }
  const activities = (message.activities ?? activitiesFromMessage(message)).map(activity => activity.type === 'tool'
    ? { ...activity, tool: { ...activity.tool } }
    : { ...activity })
  openPendingThinking(activities)
  const next = [...messages]
  next[index] = { ...message, streaming: true, activities }
  return next
}
