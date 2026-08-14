import { describe, expect, it, vi } from 'vitest'
import { applyStreamEvent, finishStreamingMessage, historyMessages, type ChatMessage } from './transcript-model'

describe('transcript model', () => {
  it('copies user history images onto ChatMessage without rewriting content', () => {
    const messages = historyMessages([
      { id: 'user-img', role: 'user', content: '看图', timestamp: 1, images: [{ data: 'abc123', mimeType: 'image/png' }] },
    ])
    expect(messages).toEqual([
      { id: 'user-img', role: 'user', content: '看图', images: [{ data: 'abc123', mimeType: 'image/png' }] },
    ])
    expect(messages[0].content).not.toContain('[1张图片]')
    expect(messages[0].content).not.toContain('[1 张图片]')
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
  })

  it('merges thinking deltas without segment info into one activity (older hosts)', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'a' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'b' })
    const thinking = messages[0].activities?.filter(activity => activity.type === 'thinking') ?? []
    expect(thinking).toHaveLength(1)
    expect(thinking[0]).toMatchObject({ content: 'ab' })
  })
})
