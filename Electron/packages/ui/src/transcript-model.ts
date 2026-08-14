import type { HistoryEntry, StreamEvent } from '@pipi/host-api'

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
  | { type: 'thinking'; id: string; contentIndex: number; content: string }
  | { type: 'tool'; contentIndex: number; tool: TranscriptTool }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  thinking?: string
  tools?: TranscriptTool[]
  activities?: TranscriptActivity[]
  streaming?: boolean
  timestamp?: number
  images?: { data: string; mimeType: string }[]
}

function isBackgroundSubagentAck(content: string): boolean {
  return /\bStarted background agent(?:\(s\)|s)?\b/i.test(content)
}

/**
 * Normalize persisted transcript truth into the live activity shape. Agent
 * liveness is deliberately absent: a tool_result always completes the durable
 * tool record, while live children remain an independent presentation layer.
 */
export function historyMessages(entries: HistoryEntry[]): ChatMessage[] {
  const cards = new Map<string, TranscriptTool>()
  const messages: ChatMessage[] = []
  for (const entry of entries) {
    if (entry.role === 'assistant' && (entry.thinking || entry.tools?.length)) {
      const tools = entry.tools?.map(tool => ({ id: tool.id, name: tool.name, input: tool.input, startedAt: entry.timestamp, finished: true }))
      for (const tool of tools ?? []) cards.set(tool.id, tool)
      const toolsById = new Map((tools ?? []).map(tool => [tool.id, tool]))
      const activities: TranscriptActivity[] = entry.activities?.map(activity => activity.type === 'thinking'
        ? { type: 'thinking', id: `${entry.id}:${activity.contentIndex}`, contentIndex: activity.contentIndex, content: activity.content }
        : { type: 'tool', contentIndex: activity.contentIndex, tool: toolsById.get(activity.tool.id) ?? { ...activity.tool, startedAt: entry.timestamp, finished: true } }) ?? [
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
      messages.push({ id: entry.id, role: 'assistant', content: entry.content, thinking: entry.thinking, tools, activities, timestamp: entry.timestamp })
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
    messages.push({ id: entry.id, role: entry.role, content: entry.content, ...(entry.role === 'user' && entry.images?.length ? { images: entry.images } : {}) })
  }
  return messages
}

export function applyStreamEvent(previous: ChatMessage[], event: Exclude<StreamEvent, { type: 'status' }>): ChatMessage[] {
  const index = previous.findLastIndex(item => item.role === 'assistant')
  const current = index >= 0 && previous[index].streaming ? previous[index] : { id: `stream-${Date.now()}`, role: 'assistant' as const, content: '', thinking: '', tools: [], streaming: true, timestamp: Date.now() }
  const next = index >= 0 && previous[index].streaming ? [...previous] : [...previous, current]
  const tools = (current.tools ?? []).map(tool => ({ ...tool }))
  const toolsById = new Map(tools.map(tool => [tool.id, tool]))
  const activities = (current.activities ?? []).map(activity => activity.type === 'thinking'
    ? { ...activity }
    : { ...activity, tool: toolsById.get(activity.tool.id) ?? { ...activity.tool } })
  const updated: ChatMessage = { ...current, tools, activities }
  if (event.type === 'text') updated.content += event.delta
  if (event.type === 'thinking') {
    updated.thinking = (updated.thinking ?? '') + event.delta
    // Pi restarts contentIndex at every assistant message, so the segment epoch
    // must be part of the key: same-index thinking from a later message is a
    // distinct block, not a continuation of the first one (history parity).
    const segment = event.segment ?? 0
    const activityIndex = activities.findIndex(activity => activity.type === 'thinking' && activity.contentIndex === event.contentIndex && activity.id === `thinking:${segment}:${event.contentIndex}`)
    if (activityIndex >= 0) {
      const activity = activities[activityIndex]
      if (activity.type === 'thinking') activities[activityIndex] = { ...activity, content: activity.content + event.delta }
    } else {
      activities.push({ type: 'thinking', id: `thinking:${segment}:${event.contentIndex}`, contentIndex: event.contentIndex, content: event.delta })
    }
  }
  if (event.type === 'tool_call') {
    const toolIndex = updated.tools!.findIndex(item => item.id === event.toolCallId)
    if (toolIndex >= 0) updated.tools![toolIndex] = { ...updated.tools![toolIndex], input: updated.tools![toolIndex].input + (event.delta ?? '') }
    else updated.tools!.push({ id: event.toolCallId, name: event.name, input: event.delta ?? '', startedAt: Date.now() })
    const tool = updated.tools![toolIndex >= 0 ? toolIndex : updated.tools!.length - 1]
    const activityIndex = activities.findIndex(activity => activity.type === 'tool' && activity.tool.id === event.toolCallId)
    if (activityIndex >= 0) activities[activityIndex] = { ...activities[activityIndex], tool } as TranscriptActivity
    else {
      const contentIndex = event.contentIndex ?? (activities.reduce((highest, activity) => Math.max(highest, activity.contentIndex), -1) + 1)
      activities.push({ type: 'tool', contentIndex, tool })
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
  }
  activities.sort((left, right) => left.contentIndex - right.contentIndex)
  next[next.length - 1] = updated
  return next
}

export function finishStreamingMessage(messages: ChatMessage[]): ChatMessage[] {
  const index = messages.findLastIndex(message => message.role === 'assistant' && message.streaming)
  if (index < 0) return messages
  const next = [...messages]
  next[index] = { ...next[index], streaming: false }
  return next
}
