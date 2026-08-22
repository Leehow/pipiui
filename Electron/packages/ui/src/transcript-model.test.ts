import { describe, expect, it, vi } from 'vitest'
import { appendLiveUserMessage, applySecretRedact, applyStreamEvent, assistantEndedAwaitingModel, assistantLooksSettled, finishStreamingMessage, historyMessages, PENDING_THINKING_ID, planTranscriptSegments, reconcileHistorySnapshot, reopenAssistantForNextCompletion, type ChatMessage } from './transcript-model'

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
})
