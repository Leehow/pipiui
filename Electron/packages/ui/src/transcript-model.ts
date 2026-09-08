import type { HistoryEntry, HistoryTool, StreamEvent, TranscriptCitation, TranscriptFileSource } from '@pipi/host-api'
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
  /** Turn closed with no result for this call (interrupt, stop, lost result). */
  interrupted?: boolean
  dispatched?: boolean
  images?: { data: string; mimeType: string }[]
  /** Structured `details` projected from the pi tool result (metadata only, never image base64). */
  details?: unknown
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
  /** assistant only: Responses url_citation / inline source URLs. */
  citations?: TranscriptCitation[]
  /** assistant only: live Chat-with-Files sources. Never includes provider file ids. */
  fileSources?: TranscriptFileSource[]
  /** assistant only: provider server-side tool usage counts, when present. */
  serverSideToolUsage?: Record<string, number>
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

function sanitizeTranscriptFileName(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  const trimmed = raw.trim()
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim()
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '')
  return cleaned.slice(0, 200).trim() || undefined
}

function mergeFileSources(existing: TranscriptFileSource[] | undefined, incoming: TranscriptFileSource[] | undefined): TranscriptFileSource[] | undefined {
  const merged = [...(existing ?? [])]
  for (const source of incoming ?? []) {
    const name = sanitizeTranscriptFileName(source.name)
    if (!name) continue
    const url = typeof source.url === 'string' ? safeHttpsFileUrl(source.url) : undefined
    const index = merged.findIndex(item => item.name === name && (item.url ?? '') === (url ?? ''))
    const next = { name, ...(url ? { url } : {}) }
    if (index < 0) {
      merged.push(next)
      continue
    }
    merged[index] = { ...merged[index], ...next }
  }
  return merged.length ? merged : existing
}

function mergeCitations(existing: TranscriptCitation[] | undefined, incoming: TranscriptCitation[] | undefined): TranscriptCitation[] | undefined {
  const merged = [...(existing ?? [])]
  for (const citation of incoming ?? []) {
    if (!citation.url || !/^https?:\/\//i.test(citation.url)) continue
    const index = merged.findIndex(item => item.url === citation.url)
    if (index < 0) {
      merged.push(citation)
      continue
    }
    merged[index] = {
      ...merged[index],
      ...citation,
      title: citation.title ?? merged[index].title,
      startIndex: citation.startIndex ?? merged[index].startIndex,
      endIndex: citation.endIndex ?? merged[index].endIndex,
      type: citation.type ?? merged[index].type,
    }
  }
  return merged.length ? merged : existing
}

function allToolsFinished(tools: TranscriptTool[] | undefined): boolean {
  return (tools?.length ?? 0) > 0 && (tools ?? []).every(tool => Boolean(tool.finished))
}

function openPendingThinking(activities: TranscriptActivity[]): boolean {
  if (activities.some(isPendingThinking)) return false
  const last = activities[activities.length - 1]
  if (last?.type === 'thinking') return false
  activities.push({ type: 'thinking', id: PENDING_THINKING_ID, contentIndex: -1, content: '' })
  return true
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
        if (entry.citations?.length) previous.citations = entry.citations
        if (entry.fileSources?.length) previous.fileSources = entry.fileSources
        continue
      }
      messages.push({ id: entry.id, role: 'assistant', content: entry.content, thinking: entry.thinking, tools, activities, timestamp: entry.timestamp, ...(entry.errorMessage ? { error: entry.errorMessage } : {}), ...(entry.citations?.length ? { citations: entry.citations } : {}), ...(entry.fileSources?.length ? { fileSources: entry.fileSources } : {}) })
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
      if (entry.details !== undefined) tool.details = entry.details
      continue
    }
    const previous = messages[messages.length - 1]
    if (entry.role === 'assistant' && entry.content && previous?.role === 'assistant' && !previous.content && (previous.activities?.length ?? 0) > 0) {
      previous.content = entry.content
      previous.id = entry.id
      previous.timestamp = entry.timestamp
      if (entry.citations?.length) previous.citations = entry.citations
      if (entry.fileSources?.length) previous.fileSources = entry.fileSources
      continue
    }
    messages.push({ id: entry.id, role: entry.role, content: entry.role === 'user' ? stripAttachmentPathsForDisplay(entry.content) : entry.content, timestamp: entry.timestamp, ...(entry.role === 'assistant' && entry.errorMessage ? { error: entry.errorMessage } : {}), ...(entry.role === 'assistant' && entry.citations?.length ? { citations: entry.citations } : {}), ...(entry.role === 'assistant' && entry.fileSources?.length ? { fileSources: entry.fileSources } : {}), ...(entry.role === 'user' && entry.images?.length ? { images: entry.images } : {}) })
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
    tools: message.tools?.map(tool => ({ id: tool.id, name: tool.name, input: tool.input, result: tool.result, error: tool.error, details: tool.details })),
    activities: message.activities?.map(activity => activity.type === 'tool'
      ? { type: activity.type, contentIndex: activity.contentIndex, toolId: activity.tool.id, result: activity.tool.result, error: activity.tool.error }
      : { type: activity.type, contentIndex: activity.contentIndex, content: activity.content }),
    citations: message.citations?.map(citation => ({ url: citation.url, title: citation.title, startIndex: citation.startIndex, endIndex: citation.endIndex })),
    fileSources: message.fileSources?.map(source => ({ name: source.name, url: source.url })),
    images: message.images?.map(image => ({ mimeType: image.mimeType, size: image.data.length })),
  })))
}

/** Keep live user follow-ups (prompts and [subagent-*] confirmations) that a
 *  same-branch history snapshot has not persisted yet. A snapshot that does not
 *  share any message with live is a branch/retry and replaces the transcript. */
export function retainLiveUserTail(snapshot: ChatMessage[], live?: readonly ChatMessage[]): ChatMessage[] {
  if (!live?.length || !snapshot.length) return snapshot
  const seenIds = new Set(snapshot.map(message => message.id))
  const seenUsers = new Set(snapshot.filter(message => message.role === 'user').map(message => message.content))
  let shared = false
  let cut = live.length
  for (let index = live.length - 1; index >= 0; index -= 1) {
    const message = live[index]
    if (seenIds.has(message.id) || (message.role === 'user' && seenUsers.has(message.content))) {
      shared = true
      cut = index + 1
      break
    }
  }
  if (!shared) return snapshot
  const extraUsers = live.slice(cut).filter(message => (
    message.role === 'user'
    && !seenIds.has(message.id)
    && !seenUsers.has(message.content)
  ))
  return extraUsers.length ? [...snapshot, ...extraUsers] : snapshot
}

/** Is the displayed transcript missing durable turns this snapshot already has?
 *  Matched on user messages only, by id or content (the same pairing
 *  `retainLiveUserTail` uses): a live streaming assistant row carries a
 *  synthetic `stream-*` id that never matches its persisted twin, so assistant
 *  rows cannot tell "live is behind" apart from "live is mid-turn".
 *
 *  A snapshot only counts as ahead of a live pane that is on its branch — one
 *  with no user turns at all (nothing to contradict), or one sharing at least
 *  one message with it. A live pane holding only an unshared row is a local
 *  optimistic prompt the snapshot predates, and replacing it would drop the
 *  user's own message. A true answer means the pane is showing less
 *  conversation than the file holds, which no fingerprint or revision check may
 *  then conclude is fine. */
export function historySnapshotAheadOfLive(
  snapshot: readonly ChatMessage[],
  live?: readonly ChatMessage[],
): boolean {
  const snapshotUsers = snapshot.filter(message => message.role === 'user')
  if (snapshotUsers.length === 0) return false
  if (!live?.length) return true
  const liveIds = new Set(live.map(message => message.id))
  const liveUserContents = new Set(live.filter(message => message.role === 'user').map(message => message.content))
  if (!snapshotUsers.some(message => !liveIds.has(message.id) && !liveUserContents.has(message.content))) return false
  if (!live.some(message => message.role === 'user')) return true
  const snapshotIds = new Set(snapshot.map(message => message.id))
  const snapshotUserContents = new Set(snapshotUsers.map(message => message.content))
  return live.some(message => snapshotIds.has(message.id)
    || (message.role === 'user' && snapshotUserContents.has(message.content)))
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
  // An unchanged file is not proof the pane is already correct. `unchanged`
  // skips the apply entirely, so it may only be reported when the transcript on
  // screen still holds every turn this snapshot has; otherwise a pane that lost
  // its messages stays lost until the file happens to change again.
  if (fingerprint === previousFingerprint && !historySnapshotAheadOfLive(messages, liveMessages)) {
    return { status: 'unchanged', messages, fingerprint }
  }
  // Only block an empty first-page snapshot from wiping a non-empty live
  // transcript. Shorter non-empty history is a legitimate branch/retry.
  if (liveMessages && liveMessages.length > 0 && messages.length === 0) {
    return {
      status: 'retained-longer-live',
      messages: [...liveMessages],
      fingerprint: previousFingerprint ?? transcriptFingerprint(liveMessages),
    }
  }
  const retained = retainLiveUserTail(messages, liveMessages)
  return {
    status: 'accepted',
    messages: retained,
    fingerprint: retained === messages ? fingerprint : transcriptFingerprint(retained),
  }
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
      next[index] = merged
      return next
    }
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
    next[next.length - 1] = merged
    return next
  }
  return [...messages, { id: incoming.id ?? `user-${Date.now()}`, role: 'user', content, timestamp: Date.now(), ...(incoming.images?.length ? { images: incoming.images } : {}) }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Display-safe https URL: drop non-https and strip token/signature query keys. */
export function safeHttpsFileUrl(url: string | undefined): string | undefined {
  if (!url || !/^https:\/\//i.test(url)) return undefined
  if (!/[?&](?:token|access_token|sig|signature|key|auth)=/i.test(url) && !/[?&](?:access|container|file|download)[_-]?token=/i.test(url)) {
    return url
  }
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|sig|signature|key|auth/i.test(key)) parsed.searchParams.delete(key)
    }
    return parsed.toString()
  } catch {
    return undefined
  }
}

function mergeHostedCodeText(prev: unknown, next: unknown): string | undefined {
  const prevCode = typeof prev === 'string' ? prev : undefined
  const nextCode = typeof next === 'string' ? next : undefined
  if (nextCode == null) return prevCode
  if (prevCode == null) return nextCode
  if (nextCode.startsWith(prevCode) || prevCode.startsWith(nextCode)) {
    return nextCode.length >= prevCode.length ? nextCode : prevCode
  }
  return nextCode
}

function mergeHostedCodeOutputs(prev: unknown, next: unknown): Array<{ type: 'logs'; text: string }> | undefined {
  const list: Array<{ type: 'logs'; text: string }> = []
  const seen = new Set<string>()
  for (const source of [prev, next]) {
    if (!Array.isArray(source)) continue
    for (const item of source) {
      if (!isRecord(item) || typeof item.text !== 'string' || !item.text) continue
      if (seen.has(item.text)) continue
      seen.add(item.text)
      list.push({ type: 'logs', text: item.text })
    }
  }
  return list.length ? list : undefined
}

function mergeHostedCodeFiles(prev: unknown, next: unknown): Array<{ filename?: string; mimeType?: string; size?: number; url?: string }> | undefined {
  const list: Array<{ filename?: string; mimeType?: string; size?: number; url?: string }> = []
  const seen = new Set<string>()
  for (const source of [prev, next]) {
    if (!Array.isArray(source)) continue
    for (const item of source) {
      if (!isRecord(item)) continue
      const filename = typeof item.filename === 'string' ? item.filename : undefined
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined
      const size = typeof item.size === 'number' ? item.size : undefined
      const url = typeof item.url === 'string' ? safeHttpsFileUrl(item.url) : undefined
      if (!filename && !mimeType && size === undefined && !url) continue
      const key = url || `${filename ?? ''}:${mimeType ?? ''}:${size ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      list.push({
        ...(filename ? { filename } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(size !== undefined ? { size } : {}),
        ...(url ? { url } : {}),
      })
    }
  }
  return list.length ? list : undefined
}

function hostedCodeLogText(outputs: Array<{ type: 'logs'; text: string }> | undefined): string | undefined {
  const text = outputs?.map(item => item.text).filter(Boolean).join('\n')
  return text || undefined
}

function mergeHostedCodeInterpreterInput(previousInput: string | undefined, event: Extract<StreamEvent, { type: 'hosted_code_interpreter' }>): string {
  let prev: Record<string, unknown> = {}
  try { prev = JSON.parse(previousInput || '{}') as Record<string, unknown> } catch { /* keep empty */ }
  const incoming: Record<string, unknown> = {
    phase: event.phase,
    ...(event.code ? { code: event.code } : {}),
    ...(event.outputs?.length ? { outputs: event.outputs } : {}),
    ...(event.files?.length ? { files: event.files } : {}),
    ...(event.error?.message ? { error: event.error.message } : {}),
  }
  const code = mergeHostedCodeText(prev.code, incoming.code)
  const outputs = mergeHostedCodeOutputs(prev.outputs, incoming.outputs)
  const files = mergeHostedCodeFiles(prev.files, incoming.files)
  return JSON.stringify({
    ...prev,
    ...incoming,
    ...(code !== undefined ? { code } : {}),
    ...(outputs ? { outputs } : {}),
    ...(files ? { files } : {}),
  })
}

export function applyStreamEvent(previous: ChatMessage[], event: Exclude<StreamEvent, { type: 'status' }>): ChatMessage[] {
  if (event.type === 'secret_redact') return applySecretRedact(previous, event.messages)
  if (event.type === 'error') return applyTurnError(previous, displaySecretPlaceholders(event.content))
  if (event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call') {
    if (event.delta) event = { ...event, delta: displaySecretPlaceholders(event.delta) }
  } else if (event.type === 'tool_result') {
    event = { ...event, content: displaySecretPlaceholders(event.content) }
  } else if (event.type === 'hosted_code_interpreter') {
    event = {
      ...event,
      ...(event.code ? { code: displaySecretPlaceholders(event.code) } : {}),
      ...(event.outputs?.length ? {
        outputs: event.outputs.map(item => ({ ...item, text: displaySecretPlaceholders(item.text) })),
      } : {}),
      ...(event.error?.message ? { error: { ...event.error, message: displaySecretPlaceholders(event.error.message) } } : {}),
    }
  }
  if (event.type !== 'text' && event.type !== 'thinking' && event.type !== 'tool_call' && event.type !== 'tool_result' && event.type !== 'hosted_search' && event.type !== 'hosted_code_interpreter' && event.type !== 'citations' && event.type !== 'input_file_sources' && event.type !== 'server_side_usage') return previous
  const eventToolId = event.type === 'tool_call' || event.type === 'tool_result'
    ? event.toolCallId
    : event.type === 'hosted_search' || event.type === 'hosted_code_interpreter'
      ? event.callId
      : undefined
  // A cut-in user message is a hard chronology boundary. Updates for an
  // already-rendered tool still belong on that earlier card, but a new model
  // activity after the cut-in must open a new assistant row after the user.
  const matchingToolAssistantIndex = eventToolId
    ? previous.findLastIndex(item => item.role === 'assistant' && item.tools?.some(tool => tool.id === eventToolId))
    : -1
  const lastAssistantIndex = previous.findLastIndex(item => item.role === 'assistant')
  const index = matchingToolAssistantIndex >= 0 ? matchingToolAssistantIndex : lastAssistantIndex
  const mayCrossUserBoundary = matchingToolAssistantIndex >= 0
    || event.type === 'citations'
    || event.type === 'input_file_sources'
    || event.type === 'server_side_usage'
  // Late hosted code-interpreter events after settle still update the last
  // assistant in place so the virtual card appears immediately.
  const reuseSettled = (event.type === 'tool_result' || event.type === 'hosted_code_interpreter' || event.type === 'input_file_sources') && index >= 0
  const canUpdate = index >= 0
    && (index === previous.length - 1 || mayCrossUserBoundary)
    && (previous[index].streaming || reuseSettled)
  const current = canUpdate ? previous[index] : { id: `stream-${Date.now()}`, role: 'assistant' as const, content: '', thinking: '', tools: [], streaming: true, timestamp: Date.now() }
  // Copy-on-write working containers: a streaming text/thinking delta only
  // rewrites the one activity it appends to, so the previous message's tools
  // array, untouched activity entries and tool objects keep their references
  // instead of being cloned per token. A container is copied (shallowly, once)
  // only by the event type that actually mutates it, and a value-identical
  // no-op event returns the previous array untouched.
  let tools = current.tools
  let activities = current.activities
  let toolsOwned = false
  let activitiesOwned = false
  let changed = !canUpdate
  const ownTools = (): TranscriptTool[] => {
    if (!toolsOwned) {
      tools = [...(tools ?? [])]
      toolsOwned = true
    }
    return tools!
  }
  const ownActivities = (): TranscriptActivity[] => {
    if (!activitiesOwned) {
      activities = [...(activities ?? [])]
      activitiesOwned = true
    }
    return activities!
  }
  const updated: ChatMessage = { ...current }
  if (event.type === 'text') {
    const nextContent = updated.content + event.delta
    if (nextContent !== updated.content) {
      updated.content = nextContent
      changed = true
    }
    const pendingIndex = (activities ?? []).findIndex(isPendingThinking)
    if (pendingIndex >= 0) {
      ownActivities().splice(pendingIndex, 1)
      changed = true
    }
    const segment = event.segment ?? 0
    const id = `text:${segment}:${event.contentIndex}`
    const activityIndex = (activities ?? []).findIndex(activity => activity.type === 'text' && activity.id === id)
    if (activityIndex >= 0) {
      const activity = activities![activityIndex]
      // An empty delta onto an existing activity appends nothing; keep the
      // entry object so repeated no-op deltas do not churn allocations.
      if (activity.type === 'text' && event.delta) {
        activities = ownActivities()
        activities[activityIndex] = { ...activity, content: activity.content + event.delta }
        changed = true
      }
    } else {
      activities = ownActivities()
      activities.push({ type: 'text', id, contentIndex: event.contentIndex, segment, content: event.delta })
      changed = true
    }
  }
  if (event.type === 'thinking') {
    const nextThinking = (updated.thinking ?? '') + event.delta
    if (nextThinking !== updated.thinking) {
      updated.thinking = nextThinking
      changed = true
    }
    // Pi restarts contentIndex at every assistant message, so the segment epoch
    // must be part of the key: same-index thinking from a later message is a
    // distinct block, not a continuation of the first one (history parity).
    const segment = event.segment ?? 0
    const pendingIndex = (activities ?? []).findIndex(isPendingThinking)
    const activityIndex = pendingIndex >= 0
      ? pendingIndex
      : (activities ?? []).findIndex(activity => activity.type === 'thinking' && activity.contentIndex === event.contentIndex && activity.id === `thinking:${segment}:${event.contentIndex}`)
    if (activityIndex >= 0) {
      const activity = activities![activityIndex]
      if (activity.type === 'thinking') {
        activities = ownActivities()
        activities[activityIndex] = {
          ...activity,
          id: `thinking:${segment}:${event.contentIndex}`,
          contentIndex: event.contentIndex,
          segment,
          content: activity.id === PENDING_THINKING_ID ? event.delta : activity.content + event.delta,
        }
        changed = true
      }
    } else {
      activities = ownActivities()
      activities.push({ type: 'thinking', id: `thinking:${segment}:${event.contentIndex}`, contentIndex: event.contentIndex, segment, content: event.delta })
      changed = true
    }
  }
  if (event.type === 'tool_call') {
    const pendingIndex = (activities ?? []).findIndex(isPendingThinking)
    if (pendingIndex >= 0) ownActivities().splice(pendingIndex, 1)
    const acts = activities ?? []
    const segment = event.segment ?? lastSegment(acts)
    let activityIndex = acts.findIndex(activity => activity.type === 'tool' && activity.tool.id === event.toolCallId)
    if (activityIndex < 0 && event.contentIndex !== undefined) {
      activityIndex = acts.findIndex(activity => activity.type === 'tool' && activity.contentIndex === event.contentIndex && (activity.segment ?? 0) === segment)
    }
    let toolIndex = activityIndex >= 0 && acts[activityIndex]?.type === 'tool'
      ? (tools ?? []).findIndex(item => item.id === (acts[activityIndex] as Extract<TranscriptActivity, { type: 'tool' }>).tool.id)
      : (tools ?? []).findIndex(item => item.id === event.toolCallId)
    const nextTools = ownTools()
    changed = true
    if (toolIndex >= 0) {
      const previousTool = nextTools[toolIndex]
      const remapping = previousTool.id !== event.toolCallId
      nextTools[toolIndex] = {
        ...previousTool,
        id: event.toolCallId,
        name: event.name && event.name !== 'tool' ? event.name : previousTool.name,
        input: remapping && event.delta ? event.delta : previousTool.input + (event.delta ?? ''),
      }
    } else {
      nextTools.push({ id: event.toolCallId, name: event.name, input: event.delta ?? '', startedAt: Date.now() })
      toolIndex = nextTools.length - 1
    }
    const tool = nextTools[toolIndex]
    if (event.status === 'completed' || event.status === 'failed') {
      const completed = {
        ...tool,
        finished: true,
        finishedAt: Date.now(),
        interrupted: false,
        error: event.status === 'failed' || tool.error,
      }
      nextTools[toolIndex] = completed
      if (activityIndex >= 0) {
        const nextActivities = ownActivities()
        nextActivities[activityIndex] = { ...nextActivities[activityIndex], tool: completed } as TranscriptActivity
      } else {
        const contentIndex = event.contentIndex ?? (acts.reduce((highest, activity) => Math.max(highest, activity.contentIndex), -1) + 1)
        ownActivities().push({ type: 'tool', contentIndex, segment, tool: completed })
      }
      if (allToolsFinished(nextTools)) openPendingThinking(ownActivities())
    } else if (activityIndex >= 0) {
      const nextActivities = ownActivities()
      nextActivities[activityIndex] = { ...nextActivities[activityIndex], tool } as TranscriptActivity
    } else {
      const contentIndex = event.contentIndex ?? (acts.reduce((highest, activity) => Math.max(highest, activity.contentIndex), -1) + 1)
      ownActivities().push({ type: 'tool', contentIndex, segment, tool })
    }
  }
  if (event.type === 'hosted_search') {
    const pendingIndex = (activities ?? []).findIndex(isPendingThinking)
    if (pendingIndex >= 0) ownActivities().splice(pendingIndex, 1)
    const acts = activities ?? []
    const segment = event.segment ?? lastSegment(acts)
    let activityIndex = acts.findIndex(activity => activity.type === 'tool' && activity.tool.id === event.callId)
    if (activityIndex < 0 && event.outputIndex !== undefined) {
      activityIndex = acts.findIndex(activity => activity.type === 'tool' && activity.contentIndex === event.outputIndex && (activity.segment ?? 0) === segment)
    }
    let toolIndex = activityIndex >= 0 && acts[activityIndex]?.type === 'tool'
      ? (tools ?? []).findIndex(item => item.id === (acts[activityIndex] as Extract<TranscriptActivity, { type: 'tool' }>).tool.id)
      : (tools ?? []).findIndex(item => item.id === event.callId)
    const finished = event.phase === 'completed' || event.phase === 'failed'
    const delta = JSON.stringify({
      phase: event.phase,
      ...(event.query ? { query: event.query } : {}),
      ...(event.sources?.length ? { sources: event.sources } : {}),
      ...(event.error?.message ? { error: event.error.message } : {}),
    })
    const nextTools = ownTools()
    changed = true
    if (toolIndex >= 0) {
      const previousTool = nextTools[toolIndex]
      nextTools[toolIndex] = {
        ...previousTool,
        id: event.callId,
        name: event.kind,
        input: event.query || event.sources?.length || event.error ? delta : previousTool.input || delta,
        finished,
        finishedAt: finished ? Date.now() : previousTool.finishedAt,
        interrupted: finished ? false : previousTool.interrupted,
        error: event.phase === 'failed' ? true : previousTool.error,
        result: event.phase === 'failed' ? (event.error?.message ?? previousTool.result) : previousTool.result,
      }
    } else {
      nextTools.push({
        id: event.callId,
        name: event.kind,
        input: delta,
        startedAt: Date.now(),
        finished,
        finishedAt: finished ? Date.now() : undefined,
        ...(event.phase === 'failed' ? { error: true } : {}),
        result: event.phase === 'failed' ? event.error?.message : undefined,
      })
      toolIndex = nextTools.length - 1
    }
    const tool = nextTools[toolIndex]
    if (activityIndex >= 0) {
      const nextActivities = ownActivities()
      nextActivities[activityIndex] = { ...nextActivities[activityIndex], tool } as TranscriptActivity
    } else {
      const contentIndex = event.outputIndex ?? (acts.reduce((highest, activity) => Math.max(highest, activity.contentIndex), -1) + 1)
      ownActivities().push({ type: 'tool', contentIndex, segment, tool })
    }
    if (finished && allToolsFinished(nextTools)) openPendingThinking(ownActivities())
    if (event.sources?.length) {
      updated.citations = mergeCitations(updated.citations, event.sources.map(source => ({
        url: source.url,
        ...(source.title ? { title: source.title } : {}),
      })))
    }
  }
  if (event.type === 'hosted_code_interpreter') {
    const pendingIndex = (activities ?? []).findIndex(isPendingThinking)
    if (pendingIndex >= 0) ownActivities().splice(pendingIndex, 1)
    const acts = activities ?? []
    const segment = event.segment ?? lastSegment(acts)
    let activityIndex = acts.findIndex(activity => activity.type === 'tool' && activity.tool.id === event.callId)
    if (activityIndex < 0 && event.outputIndex !== undefined) {
      activityIndex = acts.findIndex(activity => activity.type === 'tool' && activity.contentIndex === event.outputIndex && (activity.segment ?? 0) === segment)
    }
    let toolIndex = activityIndex >= 0 && acts[activityIndex]?.type === 'tool'
      ? (tools ?? []).findIndex(item => item.id === (acts[activityIndex] as Extract<TranscriptActivity, { type: 'tool' }>).tool.id)
      : (tools ?? []).findIndex(item => item.id === event.callId)
    const finished = event.phase === 'completed' || event.phase === 'failed'
    const previousTool = toolIndex >= 0 ? (tools ?? [])[toolIndex] : undefined
    const merged = mergeHostedCodeInterpreterInput(previousTool?.input, event)
    let parsedOutputs: Array<{ type: 'logs'; text: string }> | undefined
    try {
      const parsed = JSON.parse(merged) as Record<string, unknown>
      parsedOutputs = mergeHostedCodeOutputs(parsed.outputs, undefined)
    } catch { /* ignore */ }
    const logText = hostedCodeLogText(parsedOutputs)
    const nextTools = ownTools()
    changed = true
    if (toolIndex >= 0 && previousTool) {
      nextTools[toolIndex] = {
        ...previousTool,
        id: event.callId,
        name: 'code_interpreter',
        input: merged,
        finished,
        finishedAt: finished ? Date.now() : previousTool.finishedAt,
        error: event.phase === 'failed' ? true : previousTool.error,
        result: event.phase === 'failed'
          ? (event.error?.message ?? previousTool.result)
          : logText || previousTool.result,
      }
    } else {
      nextTools.push({
        id: event.callId,
        name: 'code_interpreter',
        input: merged,
        startedAt: Date.now(),
        finished,
        finishedAt: finished ? Date.now() : undefined,
        ...(event.phase === 'failed' ? { error: true } : {}),
        result: event.phase === 'failed' ? event.error?.message : logText,
      })
      toolIndex = nextTools.length - 1
    }
    const tool = nextTools[toolIndex]
    if (activityIndex >= 0) {
      const nextActivities = ownActivities()
      nextActivities[activityIndex] = { ...nextActivities[activityIndex], tool } as TranscriptActivity
    } else {
      const contentIndex = event.outputIndex ?? (acts.reduce((highest, activity) => Math.max(highest, activity.contentIndex), -1) + 1)
      ownActivities().push({ type: 'tool', contentIndex, segment, tool })
    }
    if (finished && allToolsFinished(nextTools) && updated.streaming) openPendingThinking(ownActivities())
  }
  if (event.type === 'citations') {
    const merged = mergeCitations(updated.citations, event.citations)
    if (merged !== updated.citations) {
      updated.citations = merged
      changed = true
    }
  }
  if (event.type === 'input_file_sources') {
    const merged = mergeFileSources(updated.fileSources, event.sources)
    if (merged !== updated.fileSources) {
      updated.fileSources = merged
      changed = true
    }
  }
  if (event.type === 'server_side_usage' && event.usage.serverSideToolUsage) {
    updated.serverSideToolUsage = { ...updated.serverSideToolUsage, ...event.usage.serverSideToolUsage }
    changed = true
  }
  if (event.type === 'tool_result') {
    const toolIndex = (tools ?? []).findIndex(item => item.id === event.toolCallId)
    if (toolIndex >= 0) {
      const nextTools = ownTools()
      const tool = nextTools[toolIndex]
      const completed = { ...tool, result: event.content, error: event.isError, finishedAt: Date.now(), finished: true, interrupted: false, dispatched: tool.name === 'subagent' && !event.isError && isBackgroundSubagentAck(event.content), images: event.images, details: event.details }
      nextTools[toolIndex] = completed
      changed = true
      const activityIndex = (activities ?? []).findIndex(activity => activity.type === 'tool' && activity.tool.id === event.toolCallId)
      if (activityIndex >= 0) {
        const nextActivities = ownActivities()
        nextActivities[activityIndex] = { ...nextActivities[activityIndex], tool: completed } as TranscriptActivity
      }
    }
    // A late result on an already settled card must not open a live thinking
    // placeholder: there is no next model hop to fill it.
    if (updated.streaming && allToolsFinished(tools) && openPendingThinking(ownActivities())) changed = true
  }
  if (!changed) return previous
  if (tools !== undefined) updated.tools = tools
  if (activities !== undefined) updated.activities = activities
  // Keep insertion order. Sorting by contentIndex is wrong: Pi restarts the
  // index every assistant message, and text/thinking often share index 0.
  const next = canUpdate ? [...previous] : [...previous, current]
  next[canUpdate ? index : next.length - 1] = updated
  return next
}

function finalizeFailedAssistantTurn(message: ChatMessage, error: string): ChatMessage {
  const tools = message.tools?.map(tool => tool.finished
    ? { ...tool }
    : { ...tool, error: true, finished: true, finishedAt: tool.finishedAt ?? tool.startedAt })
  const toolsById = tools ? new Map(tools.map(tool => [tool.id, tool])) : undefined
  const activities = message.activities
    ? stripPendingThinking(message.activities).map(activity => toolsById ? cloneActivity(activity, toolsById) : { ...activity })
    : message.activities
  return {
    ...message,
    error,
    streaming: false,
    ...(tools ? { tools } : {}),
    ...(activities ? { activities } : {}),
  }
}

/** A turn that ended in `stopReason: "error"` streams no text — surface the
 *  provider errorMessage on the assistant turn so the failure is visible
 *  instead of an empty bubble. The failed visual turn is terminal (`streaming`
 *  false) so later live events open a new turn; this is not a session settle. */
function applyTurnError(messages: ChatMessage[], content: string): ChatMessage[] {
  if (!content) return messages
  const index = messages.findLastIndex(message => message.role === 'assistant' && message.streaming)
  const next = [...messages]
  if (index >= 0) {
    next[index] = finalizeFailedAssistantTurn(next[index], content)
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

/** Close every tool a finished turn left without a result. A `tool_call` whose
 *  `tool_result` never arrived (interrupted turn, lost result) would otherwise
 *  render as 「运行中」 forever; the turn is over, so it is interrupted, not live. */
export function finalizeOpenTools(messages: ChatMessage[]): ChatMessage[] {
  let changed = false
  const next = messages.map(message => {
    const openTools = message.tools
    if (!openTools?.some(tool => !tool.finished)) return message
    changed = true
    const tools = openTools.map(tool => tool.finished
      ? tool
      : { ...tool, finished: true, finishedAt: tool.finishedAt ?? Date.now(), interrupted: true })
    const toolsById = new Map(tools.map(tool => [tool.id, tool]))
    const activities = message.activities
      ? stripPendingThinking(message.activities).map(activity => cloneActivity(activity, toolsById))
      : message.activities
    return { ...message, tools, ...(activities ? { activities } : {}) }
  })
  return changed ? next : messages
}

/** Last durable activity is a finished tool (or the live pending-thinking
 *  placeholder). A later `started` after that is the next model hop, not a
 *  ghost turn after a text-only conclusion. */
export function assistantEndedAwaitingModel(message: Pick<ChatMessage, 'role' | 'content' | 'activities' | 'thinking' | 'tools' | 'error'>): boolean {
  if (message.role !== 'assistant') return false
  if (message.error) return false
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
  if (message.error) return messages
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
