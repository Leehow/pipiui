import { describe, expect, it, vi } from 'vitest'
import { appendLiveUserMessage, applySecretRedact, applyStreamEvent, assistantEndedAwaitingModel, assistantLooksSettled, finalizeOpenTools, finishStreamingMessage, historyMessages, historySnapshotAheadOfLive, PENDING_THINKING_ID, planTranscriptSegments, reconcileHistorySnapshot, reopenAssistantForNextCompletion, safeHttpsFileUrl, type ChatMessage } from './transcript-model'

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

  it('accepts a shorter non-empty history snapshot as a legitimate branch', () => {
    const live = [
      { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'one', timestamp: 2 },
      { id: 'u2', role: 'user' as const, content: 'second', timestamp: 3 },
      { id: 'a2', role: 'assistant' as const, content: 'two', timestamp: 4 },
    ]
    const result = reconcileHistorySnapshot([
      { id: 'u2', role: 'user', content: 'second', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'two', timestamp: 4 },
    ], 4, 4, undefined, live)
    expect(result.status).toBe('accepted')
    expect(result.messages.map(message => message.id)).toEqual(['u2', 'a2'])
  })

  it('keeps a live user follow-up that the history snapshot has not persisted yet', () => {
    const live = [
      { id: 'u1', role: 'user' as const, content: '先派发', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: '已派发', timestamp: 2 },
      { id: 'done-1', role: 'user' as const, content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 修合流', timestamp: 3 },
      { id: 'steer-1', role: 'user' as const, content: '先停一下，改验证标准', timestamp: 4 },
    ]
    const result = reconcileHistorySnapshot([
      { id: 'u1', role: 'user', content: '先派发', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '已派发', timestamp: 2 },
    ], 4, 4, undefined, live)
    expect(result.status).toBe('accepted')
    expect(result.messages.map(message => message.id)).toEqual(['u1', 'a1', 'done-1', 'steer-1'])
  })

  it('keeps a later live confirmation after history replaced the streaming assistant', () => {
    const live = [
      { id: 'u1', role: 'user' as const, content: '继续', timestamp: 1 },
      { id: 'a-live', role: 'assistant' as const, content: 'partial', timestamp: 2, streaming: true },
      { id: 'done-1', role: 'user' as const, content: '[subagent-done] agentId=a1 name=explore ok=true', timestamp: 3 },
    ]
    const result = reconcileHistorySnapshot([
      { id: 'u1', role: 'user', content: '继续', timestamp: 1 },
      { id: 'a-done', role: 'assistant', content: 'done', timestamp: 2 },
    ], 4, 4, undefined, live)
    expect(result.status).toBe('accepted')
    expect(result.messages.map(message => ({ id: message.id, role: message.role }))).toEqual([
      { id: 'u1', role: 'user' },
      { id: 'a-done', role: 'assistant' },
      { id: 'done-1', role: 'user' },
    ])
  })

  it('does not let an empty history snapshot wipe a non-empty live transcript', () => {
    const live = [
      { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'one', timestamp: 2 },
    ]
    const result = reconcileHistorySnapshot([], 4, 4, undefined, live)
    expect(result.status).toBe('retained-longer-live')
    expect(result.messages.map(message => message.id)).toEqual(['u1', 'a1'])
  })

  it('accepts finished history over a streaming live assistant', () => {
    const live = [
      { id: 'u1', role: 'user' as const, content: 'ask', timestamp: 1 },
      { id: 'a-live', role: 'assistant' as const, content: 'partial', timestamp: 2, streaming: true },
    ]
    const result = reconcileHistorySnapshot([
      { id: 'u1', role: 'user', content: 'ask', timestamp: 1 },
      { id: 'a-done', role: 'assistant', content: 'done', timestamp: 2 },
    ], 4, 4, undefined, live)
    expect(result.status).toBe('accepted')
    expect(result.messages[1]).toMatchObject({ id: 'a-done', content: 'done' })
  })

  it('does not report an unchanged file as unchanged when the pane lost the turns it holds', () => {
    const entries = [
      { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'one', timestamp: 2 },
    ]
    const fingerprint = reconcileHistorySnapshot(entries, 4, 4).fingerprint
    // Same bytes on disk, but the transcript on screen went blank: the snapshot
    // must be applied, not skipped, or the pane stays empty until the file moves.
    const blank = reconcileHistorySnapshot(entries, 4, 4, fingerprint, [])
    expect(blank.status).toBe('accepted')
    expect(blank.messages.map(message => message.id)).toEqual(['u1', 'a1'])
    // A pane left holding only the newest turn is the same loss, just partial.
    const fragment = reconcileHistorySnapshot(entries, 4, 4, fingerprint, [
      { id: 'a1', role: 'assistant', content: 'one', timestamp: 2 },
    ])
    expect(fragment.status).toBe('accepted')
    expect(fragment.messages.map(message => message.id)).toEqual(['u1', 'a1'])
  })

  it('still reports unchanged when the pane already holds every persisted turn', () => {
    const entries = [
      { id: 'u1', role: 'user' as const, content: 'first', timestamp: 1 },
      { id: 'a1', role: 'assistant' as const, content: 'one', timestamp: 2 },
    ]
    const fingerprint = reconcileHistorySnapshot(entries, 4, 4).fingerprint
    const live: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'a-live', role: 'assistant', content: 'partial', timestamp: 2, streaming: true },
    ]
    // A live streaming assistant carries a synthetic id its persisted twin never
    // matches; that alone must not force a mid-turn replacement.
    expect(reconcileHistorySnapshot(entries, 4, 4, fingerprint, live).status).toBe('unchanged')
  })

  it('sees a live pane as behind when it is missing a persisted user turn', () => {
    const snapshot: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'u2', role: 'user', content: 'second', timestamp: 3 },
    ]
    expect(historySnapshotAheadOfLive(snapshot, [])).toBe(true)
    expect(historySnapshotAheadOfLive(snapshot, [snapshot[1]])).toBe(true)
    expect(historySnapshotAheadOfLive(snapshot, snapshot)).toBe(false)
    // A re-sent prompt persists under a new id; content pairing keeps it matched.
    expect(historySnapshotAheadOfLive(snapshot, [
      { id: 'live-1', role: 'user', content: 'first', timestamp: 1 },
      { id: 'live-2', role: 'user', content: 'second', timestamp: 3 },
    ])).toBe(false)
    // A history page with no user turns cannot tell us the pane is behind.
    expect(historySnapshotAheadOfLive([{ id: 'a1', role: 'assistant', content: 'one', timestamp: 2 }], [])).toBe(false)
    // A live pane holding only a local optimistic prompt shares nothing with the
    // snapshot: that is a read the prompt predates, not a pane that lost turns.
    expect(historySnapshotAheadOfLive(snapshot, [
      { id: 'local-1', role: 'user', content: '刚发出去的这一条', timestamp: 9 },
    ])).toBe(false)
  })

  it('rejects an async history response when a live stream changed after request start', () => {
    const result = reconcileHistorySnapshot([
      { id: 'old', role: 'assistant', content: 'old snapshot', timestamp: 10 },
    ], 4, 5)
    expect(result.status).toBe('stale-request')
  })

  it('maps persisted compaction entries to folded divider messages and keeps earlier bubbles', () => {
    const messages = historyMessages([
      { id: 'u1', role: 'user', content: 'old', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'reply', timestamp: 2 },
      { id: 'c1', role: 'compaction', content: 'first summary', timestamp: 3 },
      { id: 'u2', role: 'user', content: 'later', timestamp: 4 },
      { id: 'c2', role: 'compaction', content: '', timestamp: 5 },
    ])
    expect(messages.map(message => ({ id: message.id, role: message.role, content: message.content }))).toEqual([
      { id: 'u1', role: 'user', content: 'old' },
      { id: 'a1', role: 'assistant', content: 'reply' },
      { id: 'c1', role: 'compaction', content: 'first summary' },
      { id: 'u2', role: 'user', content: 'later' },
      { id: 'c2', role: 'compaction', content: '' },
    ])
    const accepted = reconcileHistorySnapshot([
      { id: 'u1', role: 'user', content: 'old', timestamp: 1 },
      { id: 'c1', role: 'compaction', content: 'first summary', timestamp: 3 },
    ], 1, 1, undefined, messages)
    expect(accepted.status).toBe('accepted')
    expect(accepted.messages.some(message => message.role === 'compaction')).toBe(true)
  })

  it('records tool_result as completed transcript truth without live agents', () => {
    const messages = historyMessages([
      { id: 'assistant', role: 'assistant', content: '', timestamp: 1, tools: [{ id: 'sub-call', name: 'subagent', input: '{}' }] },
      { id: 'result', role: 'tool', content: 'Started background agent(s) (1).\n- agentId=root', timestamp: 2, toolCallId: 'sub-call', toolName: 'subagent' },
    ])
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'sub-call', finished: true, dispatched: true, finishedAt: 2 })
  })

  it('keeps typed images and structured details on the tool record (stream + history)', () => {
    const images = [{ data: 'aGk=', mimeType: 'image/png' }]
    const details = { path: '/tmp/attachments/images/1.jpg', backend: 'grok-build', model: 'grok-imagine-image-quality' }
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'image_gen', name: 'image_gen', delta: '{}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'image_gen', content: '图像已生成: /tmp/attachments/images/1.jpg', images, details })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'image_gen', finished: true, images, details })
    // base64 never leaks into the plain result text
    expect(messages[0].tools?.[0].result).not.toContain('aGk=')

    const fromHistory = historyMessages([
      { id: 'assistant', role: 'assistant', content: '', timestamp: 1, tools: [{ id: 'image_gen', name: 'image_gen', input: '{}' }] },
      { id: 'result', role: 'tool', content: '图像已生成: /tmp/attachments/images/1.jpg', timestamp: 2, toolCallId: 'image_gen', toolName: 'image_gen', images, details },
    ])
    expect(fromHistory[0].tools?.[0]).toMatchObject({ finished: true, images, details })
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

  it('closes a tool left without a result when the turn ends, and keeps identity when nothing is open', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(20_000)
      let messages = applyStreamEvent([], { type: 'tool_call', sessionId: 's', toolCallId: 'grep', name: 'grep', delta: '{"pattern":"x"}' })
      expect(messages[0].tools?.[0]?.finished).toBeFalsy()

      messages = finalizeOpenTools(messages)
      expect(messages[0].tools?.[0]).toMatchObject({ id: 'grep', finished: true, finishedAt: 20_000, interrupted: true })
      const activity = messages[0].activities?.find(item => item.type === 'tool')
      expect(activity?.type === 'tool' && activity.tool).toMatchObject({ finished: true, interrupted: true })

      // A turn that left nothing open is a no-op, so callers keep comparing identity.
      expect(finalizeOpenTools(messages)).toBe(messages)
    } finally { vi.useRealTimers() }
  })

  it('lets a late tool_result land on a card already closed as interrupted', () => {
    let messages = applyStreamEvent([], { type: 'tool_call', sessionId: 's', toolCallId: 'grep', name: 'grep', delta: '{}' })
    messages = finalizeOpenTools(finishStreamingMessage(messages))
    expect(messages[0].streaming).toBe(false)
    expect(messages[0].tools?.[0]?.interrupted).toBe(true)

    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'grep', content: '3 hits' })
    expect(messages).toHaveLength(1)
    expect(messages[0].tools?.[0]).toMatchObject({ finished: true, result: '3 hits' })
    expect(messages[0].tools?.[0]?.interrupted).toBeFalsy()
    const activity = messages[0].activities?.find(item => item.type === 'tool')
    expect(activity?.type === 'tool' && activity.tool.interrupted).toBeFalsy()
    expect(messages[0].activities?.some(item => item.type === 'thinking' && item.id === PENDING_THINKING_ID)).toBe(false)
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

  it('reopens a history-merged tool hop when the live turn is still waiting for the next completion', () => {
    const history: ChatMessage[] = [{
      id: 'a-tools',
      role: 'assistant',
      content: '两路已结束，直接取回完整报告。',
      thinking: '先取回报告',
      tools: [
        { id: 'status-1', name: 'subagent_status', input: '{}', startedAt: 1, finished: true },
        { id: 'status-2', name: 'subagent_status', input: '{}', startedAt: 1, finished: true },
      ],
    }]
    expect(assistantEndedAwaitingModel(history[0])).toBe(false)
    expect(reopenAssistantForNextCompletion(history)).toBe(history)
    const restored = reopenAssistantForNextCompletion(history, { includeHistoryMergedToolHop: true })
    expect(restored).not.toBe(history)
    expect(restored[0]?.streaming).toBe(true)
    expect(restored[0]?.activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(true)
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

  it('keeps a cut-in user message between separate live assistant activity groups', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'first', name: 'bash', delta: '{}' })
    messages = appendLiveUserMessage(messages, { id: 'cut-in', content: '中途插入的信息' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'first', content: 'ok' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'second', name: 'read', delta: '{}' })

    expect(messages.map(message => message.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(messages[0].tools).toEqual([expect.objectContaining({ id: 'first', result: 'ok', finished: true })])
    expect(messages[1]).toMatchObject({ id: 'cut-in', role: 'user', content: '中途插入的信息' })
    expect(messages[2].tools?.map(tool => tool.id)).toEqual(['second'])
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

  it('replaces a live user bubble from secret_redact without appending a new row', () => {
    const fake = 'vault-test-secret-AAAA'
    const messages: ChatMessage[] = [
      { id: 'u-hex', role: 'user', content: `再给你 ${fake}`, timestamp: 1 },
      { id: 'a-hex', role: 'assistant', content: `echo ${fake}`, thinking: fake, timestamp: 2 },
    ]
    const next = applySecretRedact(messages, [
      { id: 'u-hex', role: 'user', content: '再给你 {{secret:CSTCLOUD_API_KEY}}' },
      { id: 'a-hex', role: 'assistant', content: 'echo {{secret:CSTCLOUD_API_KEY}}', thinking: '{{secret:CSTCLOUD_API_KEY}}' },
    ])
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ id: 'u-hex', content: '再给你 [CSTCLOUD_API_KEY]' })
    expect(next[1]).toMatchObject({ id: 'a-hex', content: 'echo [CSTCLOUD_API_KEY]', thinking: '[CSTCLOUD_API_KEY]' })
    expect(JSON.stringify(next)).not.toContain(fake)
    expect(applyStreamEvent(messages, {
      type: 'secret_redact',
      sessionId: 's',
      messages: [{ id: 'u-hex', role: 'user', content: '再给你 {{secret:CSTCLOUD_API_KEY}}' }],
    })[0].content).toBe('再给你 [CSTCLOUD_API_KEY]')
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

  it('opens a new assistant turn for events after a provider error instead of appending to the failed turn', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, delta: 'partial work' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'call-1', name: 'subagent_chain', delta: '{"goal":"' })
    messages = applyStreamEvent(messages, { type: 'error', sessionId: 's', content: 'WebSocket error' })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ content: 'partial work', error: 'WebSocket error', streaming: false })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'call-1', finished: true, error: true })
    expect(messages[0].activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)
    expect(assistantEndedAwaitingModel(messages[0])).toBe(false)
    expect(reopenAssistantForNextCompletion(messages)).toBe(messages)
    expect(reopenAssistantForNextCompletion(messages, { includeHistoryMergedToolHop: true })).toBe(messages)

    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'call-2', name: 'subagent_chain', delta: '{"goal":"retry"}' })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ error: 'WebSocket error', streaming: false })
    expect(messages[0].tools?.map(tool => tool.id)).toEqual(['call-1'])
    expect(messages[1]).toMatchObject({ role: 'assistant', streaming: true, content: '' })
    expect(messages[1].error).toBeUndefined()
    expect(messages[1].tools?.[0]).toMatchObject({ id: 'call-2', name: 'subagent_chain', input: '{"goal":"retry"}' })
  })

  it('strips pending thinking when a live turn ends in error', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-1', name: 'read', delta: '{}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-1', content: 'ok' })
    expect(messages[0].activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(true)
    messages = applyStreamEvent(messages, { type: 'error', sessionId: 's', content: 'WebSocket error' })
    expect(messages[0].streaming).toBe(false)
    expect(messages[0].error).toBe('WebSocket error')
    expect(messages[0].activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)
  })

  it('accumulates hosted search lifecycle onto one tool card and attaches citations', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'hosted_search', sessionId: 's', callId: 'ws_1', kind: 'web_search', phase: 'in_progress', query: 'pipiui', outputIndex: 1 })
    messages = applyStreamEvent(messages, { type: 'hosted_search', sessionId: 's', callId: 'ws_1', kind: 'web_search', phase: 'searching', query: 'pipiui', outputIndex: 1 })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ws_1', name: 'web_search', finished: false })
    messages = applyStreamEvent(messages, {
      type: 'hosted_search',
      sessionId: 's',
      callId: 'ws_1',
      kind: 'web_search',
      phase: 'completed',
      query: 'pipiui',
      sources: [{ url: 'https://docs.example', title: 'Docs' }],
      outputIndex: 1,
    })
    messages = applyStreamEvent(messages, {
      type: 'citations',
      sessionId: 's',
      citations: [{ url: 'https://docs.example', title: 'Docs', startIndex: 0, endIndex: 4, type: 'url_citation' }],
    })
    messages = applyStreamEvent(messages, {
      type: 'server_side_usage',
      sessionId: 's',
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 3, serverSideToolUsage: { SERVER_SIDE_TOOL_WEB_SEARCH: 1 } },
    })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ws_1', name: 'web_search', finished: true, error: undefined })
    expect(messages[0].citations).toEqual([
      { url: 'https://docs.example', title: 'Docs', startIndex: 0, endIndex: 4, type: 'url_citation' },
    ])
    expect(messages[0].serverSideToolUsage).toEqual({ SERVER_SIDE_TOOL_WEB_SEARCH: 1 })
    const fromHistory = historyMessages([
      { id: 'a', role: 'assistant', content: 'See [[1]](https://docs.example)', timestamp: 1, citations: [{ url: 'https://docs.example', title: 'Docs' }] },
    ])
    expect(fromHistory[0].citations).toEqual([{ url: 'https://docs.example', title: 'Docs' }])
  })

  it('merges live input_file_sources onto the current assistant without disturbing citations or tools', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'hosted_search', sessionId: 's', callId: 'ws_1', kind: 'web_search', phase: 'completed', query: 'q', outputIndex: 1 })
    messages = applyStreamEvent(messages, {
      type: 'citations',
      sessionId: 's',
      citations: [{ url: 'https://docs.example', title: 'Docs' }],
    })
    messages = applyStreamEvent(messages, {
      type: 'input_file_sources',
      sessionId: 's',
      sources: [{ name: '/secret/report.pdf' }, { name: 'notes.md', url: 'https://files.example/notes.md?access_token=abc' }],
    })
    messages = applyStreamEvent(messages, {
      type: 'input_file_sources',
      sessionId: 's',
      sources: [{ name: 'report.pdf' }, { name: 'notes.md', url: 'https://files.example/notes.md' }],
    })
    messages = applyStreamEvent(messages, {
      type: 'server_side_usage',
      sessionId: 's',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 2, serverSideToolUsage: { SERVER_SIDE_TOOL_WEB_SEARCH: 1 } },
    })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ws_1', name: 'web_search', finished: true })
    expect(messages[0].citations).toEqual([{ url: 'https://docs.example', title: 'Docs' }])
    expect(messages[0].fileSources).toEqual([
      { name: 'report.pdf' },
      { name: 'notes.md', url: 'https://files.example/notes.md' },
    ])
    expect(messages[0].serverSideToolUsage).toEqual({ SERVER_SIDE_TOOL_WEB_SEARCH: 1 })
    expect(JSON.stringify(messages[0].fileSources)).not.toContain('/secret/')
    expect(JSON.stringify(messages[0].fileSources)).not.toContain('access_token')
  })

  it('keeps fileSources from resumed history and dedupes a later terminal replay', () => {
    const fromHistory = historyMessages([
      {
        id: 'a',
        role: 'assistant',
        content: 'Based on the upload',
        timestamp: 1,
        citations: [{ url: 'https://docs.example', title: 'Docs' }],
        fileSources: [{ name: 'report.pdf' }, { name: 'notes.md', url: 'https://files.example/notes.md' }],
      },
    ])
    expect(fromHistory[0].fileSources).toEqual([
      { name: 'report.pdf' },
      { name: 'notes.md', url: 'https://files.example/notes.md' },
    ])
    expect(fromHistory[0].citations).toEqual([{ url: 'https://docs.example', title: 'Docs' }])
    let replayed = applyStreamEvent(fromHistory.map(message => ({ ...message, streaming: true })), {
      type: 'input_file_sources',
      sessionId: 's',
      sources: [{ name: 'report.pdf' }, { name: 'notes.md', url: 'https://files.example/notes.md' }],
    })
    expect(replayed[0].fileSources).toEqual(fromHistory[0].fileSources)
  })

  it('accumulates hosted code interpreter lifecycle onto one dedicated tool card', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'queued', outputIndex: 1 })
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'in_progress', code: 'print(', outputIndex: 1 })
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'in_progress', code: 'print(1)', outputIndex: 1 })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ci_1', name: 'code_interpreter', finished: false })
    messages = applyStreamEvent(messages, {
      type: 'hosted_code_interpreter',
      sessionId: 's',
      callId: 'ci_1',
      phase: 'completed',
      code: 'print(1)',
      outputs: [{ type: 'logs', text: '1' }],
      files: [{ filename: 'out.csv', mimeType: 'text/csv', url: 'https://files.example/out.csv' }],
      outputIndex: 1,
    })
    messages = applyStreamEvent(messages, {
      type: 'server_side_usage',
      sessionId: 's',
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 3, serverSideToolUsage: { SERVER_SIDE_TOOL_CODE_EXECUTION: 1 } },
    })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ci_1', name: 'code_interpreter', finished: true, error: undefined, result: '1' })
    expect(JSON.parse(messages[0].tools?.[0].input ?? '{}')).toMatchObject({
      phase: 'completed',
      code: 'print(1)',
      outputs: [{ type: 'logs', text: '1' }],
      files: [{ filename: 'out.csv', mimeType: 'text/csv', url: 'https://files.example/out.csv' }],
    })
    expect(messages[0].serverSideToolUsage).toEqual({ SERVER_SIDE_TOOL_CODE_EXECUTION: 1 })
    const replayed = applyStreamEvent(messages, {
      type: 'hosted_code_interpreter',
      sessionId: 's',
      callId: 'ci_1',
      phase: 'completed',
      code: 'print(1)',
      outputs: [{ type: 'logs', text: '1' }],
      outputIndex: 1,
    })
    expect(replayed[0].tools).toHaveLength(1)
    expect(replayed[0].tools?.[0].id).toBe('ci_1')
    const fromHistory = historyMessages([
      { id: 'a', role: 'assistant', content: 'done', timestamp: 1, tools: [{ id: 'ci_1', name: 'code_interpreter', input: JSON.stringify({ phase: 'completed', code: 'print(1)', outputs: [{ type: 'logs', text: '1' }] }) }] },
    ])
    expect(fromHistory[0].tools?.[0]).toMatchObject({ id: 'ci_1', name: 'code_interpreter', finished: true })
  })

  it('marks a failed hosted code interpreter card without leaking secrets', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, {
      type: 'hosted_code_interpreter',
      sessionId: 's',
      callId: 'ci_fail',
      phase: 'failed',
      code: 'raise SystemExit',
      error: { code: 'execution_error', message: 'boom' },
    })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ci_fail', name: 'code_interpreter', finished: true, error: true, result: 'boom' })
  })

  it('keeps queued/in_progress/interpreting running and merges incremental logs/files for one call', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'queued', outputIndex: 1 })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ci_1', finished: false })
    expect(messages[0].tools?.[0].error).toBeFalsy()
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'interpreting', code: 'print(', outputs: [{ type: 'logs', text: 'a' }], outputIndex: 1 })
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'interpreting', code: 'print(1)', outputs: [{ type: 'logs', text: 'b' }], files: [{ filename: 'a.csv', url: 'https://files.example/a.csv' }], outputIndex: 1 })
    expect(messages[0].tools?.[0].finished).toBeFalsy()
    messages = applyStreamEvent(messages, {
      type: 'hosted_code_interpreter',
      sessionId: 's',
      callId: 'ci_1',
      phase: 'completed',
      files: [{ filename: 'b.png', url: 'https://files.example/b.png?token=SECRET&download_token=ALSO' }],
      outputs: [{ type: 'logs', text: 'b' }],
      outputIndex: 1,
    })
    expect(messages[0].tools).toHaveLength(1)
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ci_1', finished: true, result: 'a\nb' })
    const input = JSON.parse(messages[0].tools?.[0].input ?? '{}') as { code?: string; outputs?: unknown; files?: Array<{ filename?: string; url?: string }> }
    expect(input.code).toBe('print(1)')
    expect(input.outputs).toEqual([{ type: 'logs', text: 'a' }, { type: 'logs', text: 'b' }])
    expect(input.files).toEqual([
      { filename: 'a.csv', url: 'https://files.example/a.csv' },
      { filename: 'b.png', url: 'https://files.example/b.png' },
    ])
    expect(JSON.stringify(input)).not.toContain('SECRET')
    expect(JSON.stringify(input)).not.toContain('token=')
  })

  it('applies a late hosted code interpreter event onto a settled turn without a new bubble', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_late', phase: 'in_progress', code: 'print(1)' })
    messages = finishStreamingMessage(messages)
    expect(messages).toHaveLength(1)
    expect(messages[0].streaming).toBe(false)
    messages = applyStreamEvent(messages, {
      type: 'hosted_code_interpreter',
      sessionId: 's',
      callId: 'ci_late',
      phase: 'completed',
      code: 'print(1)',
      outputs: [{ type: 'logs', text: '1' }],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].streaming).toBe(false)
    expect(messages[0].tools).toHaveLength(1)
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'ci_late', name: 'code_interpreter', finished: true, result: '1' })
    expect(messages[0].activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)
  })

  it('redacts secret placeholders and drops non-https file URLs on hosted code events', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, {
      type: 'hosted_code_interpreter',
      sessionId: 's',
      callId: 'ci_secret',
      phase: 'failed',
      code: 'print("{{secret:API_KEY}}")',
      outputs: [{ type: 'logs', text: 'leak {{secret:API_KEY}}' }],
      files: [{ filename: 'out.csv', url: 'http://evil.example/out.csv' }],
      error: { code: 'execution_error', message: 'boom {{secret:API_KEY}}' },
    })
    const tool = messages[0].tools?.[0]
    expect(tool).toMatchObject({ id: 'ci_secret', finished: true, error: true, result: 'boom [API_KEY]' })
    expect(tool?.input).toContain('[API_KEY]')
    expect(tool?.input).not.toContain('{{secret:')
    expect(JSON.parse(tool?.input ?? '{}').files).toEqual([{ filename: 'out.csv' }])
    expect(safeHttpsFileUrl('https://files.example/a.csv?access_token=abc')).toBe('https://files.example/a.csv')
    expect(safeHttpsFileUrl('http://files.example/a.csv')).toBeUndefined()
  })

  it('does not reorder hosted search, ordinary tools or thinking when a code interpreter card is present', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'plan' })
    messages = applyStreamEvent(messages, { type: 'hosted_search', sessionId: 's', callId: 'ws_1', kind: 'web_search', phase: 'completed', query: 'q', outputIndex: 1 })
    messages = applyStreamEvent(messages, { type: 'hosted_code_interpreter', sessionId: 's', callId: 'ci_1', phase: 'completed', code: '1', outputIndex: 2 })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-1', name: 'read', delta: '{}', contentIndex: 3 })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-1', content: 'ok' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 4, delta: 'done' })
    expect(messages[0].activities?.map(activity => {
      if (activity.type === 'thinking') return `thinking:${activity.content}`
      if (activity.type === 'text') return `text:${activity.content}`
      return `tool:${activity.tool.name}`
    })).toEqual(['thinking:plan', 'tool:web_search', 'tool:code_interpreter', 'tool:read', 'text:done'])
    expect(messages[0].tools?.every(tool => tool.finished)).toBe(true)
    const untouched = [{ id: 'a', role: 'assistant' as const, content: 'old', timestamp: 1 }]
    expect(applyStreamEvent(untouched, { type: 'session_title', sessionId: 's', title: 'x', source: 'model' } as never)).toEqual(untouched)
  })

  it('finishes a hosted search fallback tool_call via status without a tool_result', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'xs_1', name: 'x_search', delta: '{"query":"from:xai","phase":"searching"}', status: 'running' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'xs_1', name: 'x_search', delta: '{"query":"from:xai","phase":"completed"}', status: 'completed' })
    expect(messages[0].tools?.[0]).toMatchObject({ id: 'xs_1', name: 'x_search', finished: true })
  })
})
