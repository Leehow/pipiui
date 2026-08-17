import { describe, expect, it, vi } from 'vitest'
import { appendLiveUserMessage, applyStreamEvent, assistantEndedAwaitingModel, assistantLooksSettled, finishStreamingMessage, historyMessages, PENDING_THINKING_ID, planTranscriptSegments, reconcileHistorySnapshot, type ChatMessage } from './transcript-model'

describe('transcript model', () => {
  it('copies user history images onto ChatMessage without rewriting content', () => {
    const messages = historyMessages([
      { id: 'user-img', role: 'user', content: '看图', timestamp: 1, images: [{ data: 'abc123', mimeType: 'image/png' }] },
    ])
    expect(messages).toEqual([
      { id: 'user-img', role: 'user', content: '看图', timestamp: 1, images: [{ data: 'abc123', mimeType: 'image/png' }] },
    ])
    expect(messages[0].content).not.toContain('[1张图片]')
    expect(messages[0].content).not.toContain('[1 张图片]')
  })

  it('preserves ordinary persisted timestamps without using them as ancestry', () => {
    const entries = [
      { id: 'u', role: 'user' as const, content: 'question', timestamp: 7 },
      { id: 'a', role: 'assistant' as const, content: 'answer', timestamp: 7 },
    ]
    const result = reconcileHistorySnapshot(entries, 3, 3)
    expect(result.status).toBe('accepted')
    expect(result.messages).toEqual([
      { id: 'u', role: 'user', content: 'question', timestamp: 7 },
      { id: 'a', role: 'assistant', content: 'answer', timestamp: 7 },
    ])
  })

  it('accepts a shorter authoritative branch or compaction snapshot', () => {
    const result = reconcileHistorySnapshot([
      { id: 'compact', role: 'assistant', content: 'compacted summary', timestamp: 1 },
    ], 4, 4, JSON.stringify([{ id: 'old-a' }, { id: 'old-b' }]))
    expect(result.status).toBe('accepted')
    expect(result.messages.map(message => message.id)).toEqual(['compact'])
  })

  it('rejects an async history response when a live stream changed after request start', () => {
    const result = reconcileHistorySnapshot([
      { id: 'old', role: 'assistant', content: 'old snapshot', timestamp: 10 },
    ], 4, 5)
    expect(result.status).toBe('stale-request')
  })

  it('records tool_result as completed transcript truth without live agents', () => {
    const messages = historyMessages([
      { id: 'assistant', role: 'assistant', content: '', timestamp: 1, tools: [{ id: 'sub-call', name: 'subagent', input: '{}' }] },
      { id: 'result', role: 'tool', content: 'Started background agent(s) (1).\n- agentId=root', timestamp: 2, toolCallId: 'sub-call', toolName: 'subagent' },
    ])
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'sub-call', finished: true, dispatched: true, finishedAt: 2 })
  })

  it('preserves a completed duration and settles only the streaming assistant', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(10_000)
      let messages: ChatMessage[] = []
      messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read', name: 'read', delta: '{}' })
      vi.setSystemTime(11_400)
      messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read', content: 'ok' })
      expect(messages[0].tools?.[0]).toMatchObject({ finished: true, finishedAt: 11_400 })
      expect(finishStreamingMessage(messages)[0].streaming).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('opens a pending thinking block after the last tool so a silent next completion stays visible', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: 'first look' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read', name: 'read', delta: '{}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read', content: 'ok' })
    const pending = messages[0].activities?.filter(activity => activity.type === 'thinking') ?? []
    expect(pending).toHaveLength(2)
    expect(pending[1]).toMatchObject({ id: PENDING_THINKING_ID, content: '' })
    expect(messages[0].streaming).toBe(true)

    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: 'next look' })
    const filled = messages[0].activities?.filter(activity => activity.type === 'thinking') ?? []
    expect(filled).toHaveLength(2)
    expect(filled[1]).toMatchObject({ content: 'next look' })
    expect(filled[1]?.type === 'thinking' && filled[1].id).not.toBe(PENDING_THINKING_ID)

    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })
    expect(messages[0].activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)

    const settled = finishStreamingMessage(applyStreamEvent(
      applyStreamEvent([], { type: 'tool_call', sessionId: 's', toolCallId: 'grep', name: 'grep', delta: '{}' }),
      { type: 'tool_result', sessionId: 's', toolCallId: 'grep', content: 'none' },
    ))
    expect(settled[0].streaming).toBe(false)
    expect(settled[0].activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)
  })

  it('treats text-then-tools as awaiting the next model hop, not a history conclusion', () => {
    const live: ChatMessage = {
      id: 'live',
      role: 'assistant',
      content: '先核对缓存',
      activities: [
        { type: 'text', id: 't', contentIndex: 0, content: '先核对缓存' },
        { type: 'tool', contentIndex: 1, tool: { id: 'read', name: 'read', input: '{}', startedAt: 1, finished: true } },
      ],
    }
    expect(assistantEndedAwaitingModel(live)).toBe(true)
    expect(assistantEndedAwaitingModel({
      role: 'assistant',
      content: '调整完成：src 布局就位。',
      tools: [{ id: 'bash', name: 'bash', input: '{}', startedAt: 1, finished: true }],
    })).toBe(false)
  })

  it('treats a text conclusion as settled even when streaming was left stuck on', () => {
    expect(assistantLooksSettled({
      role: 'assistant',
      content: '这是一个 COC 守秘人产品仓库。',
      activities: [{ type: 'text', id: 't', contentIndex: 0, content: '这是一个 COC 守秘人产品仓库。' }],
    })).toBe(true)
    expect(assistantLooksSettled({
      role: 'assistant',
      content: '先核对缓存',
      activities: [
        { type: 'text', id: 't', contentIndex: 0, content: '先核对缓存' },
        { type: 'tool', contentIndex: 1, tool: { id: 'read', name: 'read', input: '{}', startedAt: 1, finished: true } },
      ],
    })).toBe(false)
  })

  it('keeps same-index thinking from later assistant messages as separate activities', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: 'first block' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read', name: 'read', delta: '{}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read', content: 'ok' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: 'second block' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: ' continues' })
    const thinking = messages[0].activities?.filter(activity => activity.type === 'thinking') ?? []
    expect(thinking).toHaveLength(2)
    expect(thinking[0]).toMatchObject({ content: 'first block' })
    expect(thinking[1]).toMatchObject({ content: 'second block continues' })
    // Pi restarts contentIndex each assistant message. Sorting by contentIndex
    // alone would pile both thinkings (index 0) above the tool (index 1).
    expect(messages[0].activities?.map(activity => activity.type === 'thinking' ? `thinking:${activity.content}` : activity.type === 'text' ? `text:${activity.content}` : `tool:${activity.tool.name}`)).toEqual([
      'thinking:first block', 'tool:read', 'thinking:second block continues',
    ])
  })

  it('keeps mid-turn text between thinking and tools instead of dumping it after the pile', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: 'inspect A' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 0, delta: '先读 A' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 0, toolCallId: 'read-a', name: 'read', delta: '{}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-a', content: 'a' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: 'inspect B' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '再读 B' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 1, toolCallId: 'read-b', name: 'read', delta: '{}' })
    expect(messages[0].activities?.map(activity => activity.type === 'thinking' ? `thinking:${activity.content}` : activity.type === 'text' ? `text:${activity.content}` : `tool:${activity.tool.name}`)).toEqual([
      'thinking:inspect A', 'text:先读 A', 'tool:read',
      'thinking:inspect B', 'text:再读 B', 'tool:read',
    ])
  })

  it('splits step groups at mid-turn text so prose is not swallowed into the pile', () => {
    const segments = planTranscriptSegments([
      { type: 'thinking', id: 't0', contentIndex: 0, content: 'inspect A' },
      { type: 'text', id: 'x0', contentIndex: 1, content: '先读 A' },
      { type: 'tool', contentIndex: 2, tool: { id: 'read-a', name: 'read', input: '{}', startedAt: 1 } },
      { type: 'thinking', id: 't1', contentIndex: 0, content: 'inspect B' },
      { type: 'text', id: 'x1', contentIndex: 1, content: '再读 B' },
      { type: 'tool', contentIndex: 2, tool: { id: 'read-b', name: 'read', input: '{}', startedAt: 2 } },
    ])
    expect(segments.map(segment => segment.type === 'text' ? `text:${segment.content}` : segment.activities.map(activity => activity.type).join('+'))).toEqual([
      'thinking', 'text:先读 A', 'tool+thinking', 'text:再读 B', 'tool',
    ])
  })

  it('promotes a provisional tool card to the real id/name without duplicating args', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 1, toolCallId: 'content-1', name: 'tool', delta: '' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 1, toolCallId: 'content-1', name: 'tool', delta: '{"path":"QuotaPill.tsx"}' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 1, toolCallId: 'call-real', name: 'read', delta: '{"path":"QuotaPill.tsx"}' })
    expect(messages[0].tools).toEqual([expect.objectContaining({ id: 'call-real', name: 'read', input: '{"path":"QuotaPill.tsx"}' })])
    expect(messages[0].activities).toEqual([expect.objectContaining({ type: 'tool', contentIndex: 1, tool: expect.objectContaining({ id: 'call-real', name: 'read' }) })])
  })

  it('merges thinking deltas without segment info into one activity (older hosts)', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'a' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'b' })
    const thinking = messages[0].activities?.filter(activity => activity.type === 'thinking') ?? []
    expect(thinking).toHaveLength(1)
    expect(thinking[0]).toMatchObject({ content: 'ab' })
  })

  it('appends a live follow-up user message and dedupes the optimistic send echo', () => {
    const first = appendLiveUserMessage([], { content: '[subagent-done] agentId=a1 name=explore ok=true', id: 'done-1' })
    expect(first).toEqual([expect.objectContaining({ role: 'user', content: '[subagent-done] agentId=a1 name=explore ok=true', id: 'done-1' })])
    expect(appendLiveUserMessage(first, { content: '[subagent-done] agentId=a1 name=explore ok=true', id: 'done-2' })).toEqual(first)
    const afterAssistant = appendLiveUserMessage(
      [...first, { id: 'a', role: 'assistant', content: '计划' }],
      { content: '[subagent-done] agentId=a1 name=explore ok=true', id: 'done-3' },
    )
    expect(afterAssistant).toHaveLength(3)
    expect(afterAssistant[2]).toMatchObject({ id: 'done-3', role: 'user' })
  })

  it('replaces the optimistic image send with the annotated server echo instead of a second bubble', () => {
    const note = '(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)'
    const optimistic: ChatMessage[] = [{
      id: 'local',
      role: 'user',
      content: '回到最新中国按钮不好看，你弄一个下箭头吧',
      images: [{ data: 'abc', mimeType: 'image/png' }],
      timestamp: 1,
    }]
    const next = appendLiveUserMessage(optimistic, {
      id: 'srv',
      content: `回到最新中国按钮不好看，你弄一个下箭头吧\n\nAttached image file: /Users/haoli/leehow/code/pipiui/.pi/attachments/shot.png\n${note}`,
    })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      id: 'srv',
      role: 'user',
      content: '回到最新中国按钮不好看，你弄一个下箭头吧',
      images: [{ data: 'abc', mimeType: 'image/png' }],
    })
  })

  it('merges the echo by id in place even after an assistant placeholder streamed past the optimistic bubble', () => {
    const messages: ChatMessage[] = [
      { id: 'local', role: 'user', content: '看图', timestamp: 1 },
      { id: 'a', role: 'assistant', content: '', thinking: '', tools: [], streaming: true, timestamp: 2 },
    ]
    const next = appendLiveUserMessage(messages, { id: 'srv', content: '看图' }, { id: 'local', content: '看图' })
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ id: 'srv', role: 'user', content: '看图' })
    expect(next[1].role).toBe('assistant')
  })

  it('replaces an image-only optimistic bubble when the echo is only the attachment footnote', () => {
    const note = '(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)'
    const optimistic: ChatMessage[] = [{ id: 'local', role: 'user', content: '', images: [{ data: 'abc', mimeType: 'image/png' }], timestamp: 1 }]
    const next = appendLiveUserMessage(optimistic, { id: 'srv', content: `\nAttached image file: /tmp/a.png\n${note}` })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'srv', role: 'user', content: '', images: [{ data: 'abc', mimeType: 'image/png' }] })
  })

  it('still appends a later user message with different prose', () => {
    const first = appendLiveUserMessage([], { content: '第一问', id: 'u1' })
    const next = appendLiveUserMessage(first, { content: '第二问', id: 'u2' })
    expect(next).toHaveLength(2)
    expect(next[1]).toMatchObject({ id: 'u2', content: '第二问' })
  })

  it('does not open an empty streaming assistant for unknown stream events', () => {
    const previous: ChatMessage[] = [{ id: 'a', role: 'assistant', content: '计划' }]
    expect(applyStreamEvent(previous, { type: 'session_title', sessionId: 's', title: 'x', source: 'model' } as never)).toEqual(previous)
  })

  it('surfaces a terminal provider error on the assistant turn instead of an empty bubble', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'error', sessionId: 's', content: "Codex error: Invalid schema for function 'subagent': ..." })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'assistant', content: '', error: "Codex error: Invalid schema for function 'subagent': ...", streaming: false })
    // The turn is terminal: a settled status must not flip anything back.
    expect(finishStreamingMessage(messages)).toEqual(messages)
  })

  it('keeps partial text when an in-flight turn ends in error and marks the message', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, delta: 'partial work' })
    messages = applyStreamEvent(messages, { type: 'error', sessionId: 's', content: 'connection reset' })
    expect(messages[0]).toMatchObject({ content: 'partial work', error: 'connection reset', streaming: false })
  })

  it('restores a failed turn from history with its error message', () => {
    const messages = historyMessages([
      { id: 'u1', role: 'user', content: 'go', timestamp: 1 },
      { id: 'fail-1', role: 'assistant', content: '', timestamp: 2, errorMessage: "Codex error: Invalid schema for function 'subagent': ..." },
    ])
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '', error: "Codex error: Invalid schema for function 'subagent': ..." })
  })
})
