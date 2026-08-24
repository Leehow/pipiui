import { describe, expect, it } from 'vitest'
import { applyStreamEvent, PENDING_THINKING_ID, type ChatMessage } from './transcript-model'

const lastMessage = (messages: ChatMessage[]) => messages[messages.length - 1]

/** A mid-turn streaming assistant: thinking → two finished tools, so the last
 *  activity is the pending-thinking placeholder opened by the finished tools. */
function seedStreamingTurn(): ChatMessage[] {
  let messages: ChatMessage[] = []
  messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: '计划' })
  messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-a', name: 'read', delta: '{"path":"a"}' })
  messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-a', content: 'a' })
  messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-b', name: 'read', delta: '{"path":"b"}' })
  messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-b', content: 'b' })
  return messages
}

describe('applyStreamEvent copy-on-write streaming state', () => {
  it('reuses the tools array and untouched activity entries across text deltas', () => {
    const messages = seedStreamingTurn()
    const before = lastMessage(messages)
    const beforeSnapshot = structuredClone(before)
    expect(before.activities?.at(-1)).toMatchObject({ type: 'thinking', id: PENDING_THINKING_ID })

    const first = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })
    const afterFirst = lastMessage(first)
    expect(afterFirst).not.toBe(before)
    expect(afterFirst.content).toBe('结论')
    // Hot-path invariant: a text delta clones neither the tools array nor any
    // tool object — references must stay identical instead of being rebuilt.
    expect(afterFirst.tools).toBe(before.tools)
    expect(afterFirst.tools?.[0]).toBe(before.tools?.[0])
    expect(afterFirst.tools?.[1]).toBe(before.tools?.[1])
    // Activities are copy-on-write: a new array, but untouched entries keep
    // their object identity; the pending placeholder is dropped and the text
    // activity lands at the end.
    expect(afterFirst.activities).not.toBe(before.activities)
    expect(afterFirst.activities?.[0]).toBe(before.activities?.[0])
    expect(afterFirst.activities?.[1]).toBe(before.activities?.[1])
    expect(afterFirst.activities?.[2]).toBe(before.activities?.[2])
    expect(afterFirst.activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)
    expect(afterFirst.activities?.at(-1)).toMatchObject({ type: 'text', content: '结论' })

    const second = applyStreamEvent(first, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '完成' })
    const afterSecond = lastMessage(second)
    expect(afterSecond.content).toBe('结论完成')
    expect(afterSecond.tools).toBe(afterFirst.tools)
    expect(afterSecond.activities?.[0]).toBe(afterFirst.activities?.[0])
    expect(afterSecond.activities?.at(-1)).toMatchObject({ type: 'text', content: '结论完成' })

    // The previous message and its containers are never mutated in place.
    expect(before).toEqual(beforeSnapshot)
    expect(afterFirst.activities?.at(-1)).toMatchObject({ type: 'text', content: '结论' })
  })

  it('reuses the tools array and tool activities across thinking deltas', () => {
    const messages = seedStreamingTurn()
    const before = lastMessage(messages)
    const next = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: '下一步' })
    const after = lastMessage(next)
    expect(after.thinking).toBe('计划下一步')
    expect(after.tools).toBe(before.tools)
    expect(after.activities).not.toBe(before.activities)
    // The first thinking block, both tool activities and their tool objects are
    // untouched — the pending placeholder is replaced in place at its position.
    expect(after.activities?.[0]).toBe(before.activities?.[0])
    expect(after.activities?.[1]).toBe(before.activities?.[1])
    expect(after.activities?.[2]).toBe(before.activities?.[2])
    const replaced = after.activities?.at(-1)
    expect(replaced).toMatchObject({ type: 'thinking', id: 'thinking:1:0', content: '下一步' })
    expect(replaced?.type === 'thinking' && replaced.content).toBe('下一步')
    expect(after.activities?.some(activity => activity.type === 'thinking' && activity.id === PENDING_THINKING_ID)).toBe(false)
  })

  it('keeps tool activity .tool identical to the tools array entry (shared object)', () => {
    const messages = seedStreamingTurn()
    const next = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })
    const after = lastMessage(next)
    const toolActivities = (after.activities ?? []).filter(activity => activity.type === 'tool')
    for (const activity of toolActivities) {
      if (activity.type !== 'tool') continue
      expect(after.tools?.includes(activity.tool)).toBe(true)
      expect(activity.tool).toBe(after.tools?.find(tool => tool.id === activity.tool.id))
    }
    expect(toolActivities).toHaveLength(2)
  })

  it('copies the tools container once for a tool_call and keeps other entries identical', () => {
    const messages = seedStreamingTurn()
    const before = lastMessage(messages)
    const next = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 1, toolCallId: 'read-c', name: 'read', delta: '{"path":"c"}' })
    const after = lastMessage(next)
    expect(after.tools).not.toBe(before.tools)
    expect(after.tools?.[0]).toBe(before.tools?.[0])
    expect(after.tools?.[1]).toBe(before.tools?.[1])
    expect(after.tools?.[2]).toMatchObject({ id: 'read-c', name: 'read', input: '{"path":"c"}' })
    expect(after.tools?.[2]?.finished).toBeFalsy()
    // New activities array (pending placeholder spliced, tool appended), with
    // untouched entries stable and the activity sharing the new tool object.
    expect(after.activities).not.toBe(before.activities)
    expect(after.activities?.[0]).toBe(before.activities?.[0])
    expect(after.activities?.[1]).toBe(before.activities?.[1])
    expect(after.activities?.[2]).toBe(before.activities?.[2])
    const toolActivity = after.activities?.at(-1)
    expect(toolActivity?.type === 'tool' && toolActivity.tool).toBe(after.tools?.[2])
  })

  it('copies only the completed tool entry on tool_result', () => {
    let messages = seedStreamingTurn()
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 1, toolCallId: 'read-c', name: 'read', delta: '{"path":"c"}' })
    const before = lastMessage(messages)
    const next = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-c', content: 'c' })
    const after = lastMessage(next)
    expect(after.tools).not.toBe(before.tools)
    expect(after.tools?.[0]).toBe(before.tools?.[0])
    expect(after.tools?.[1]).toBe(before.tools?.[1])
    expect(after.tools?.[2]).not.toBe(before.tools?.[2])
    expect(after.tools?.[2]).toMatchObject({ id: 'read-c', finished: true, result: 'c' })
    const activity = (after.activities ?? []).find(activity => activity.type === 'tool' && activity.tool.id === 'read-c')
    expect(activity?.type === 'tool' && activity.tool).toBe(after.tools?.[2])
  })

  it('returns the previous state untouched for no-op events', () => {
    const seeded = seedStreamingTurn()
    // One text delta clears the pending placeholder so later no-ops are pure.
    const messages = applyStreamEvent(seeded, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })

    // Unknown event types keep the exact previous array reference.
    expect(applyStreamEvent(messages, { type: 'session_title', sessionId: 's', title: 'x', source: 'model' } as never)).toBe(messages)
    // An empty text delta onto the existing activity changes no value.
    expect(applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '' })).toBe(messages)
    // Citations that all fail validation (no http(s) URL) add nothing.
    expect(applyStreamEvent(messages, { type: 'citations', sessionId: 's', citations: [{ url: 'ftp://nope', title: 'x' }] })).toBe(messages)
    // server_side_usage without the server-side usage record adds nothing.
    expect(applyStreamEvent(messages, { type: 'server_side_usage', sessionId: 's', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 2 } })).toBe(messages)
    // A tool_result for an unknown toolCallId while another tool is still
    // running completes nothing and reopens no pending thinking.
    const withRunningTool = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-c', name: 'read', delta: '{}' })
    expect(applyStreamEvent(withRunningTool, { type: 'tool_result', sessionId: 's', toolCallId: 'missing', content: 'x' })).toBe(withRunningTool)
  })

  it('keeps tools/activities references for duplicate citations', () => {
    let messages = seedStreamingTurn()
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })
    const citation = { url: 'https://docs.example', title: 'Docs', startIndex: 0, endIndex: 4, type: 'url_citation' as const }
    const first = applyStreamEvent(messages, { type: 'citations', sessionId: 's', citations: [citation] })
    const before = lastMessage(first)
    const second = applyStreamEvent(first, { type: 'citations', sessionId: 's', citations: [citation] })
    const after = lastMessage(second)
    // Duplicate citations dedupe to the same values without disturbing the
    // tools/activities containers.
    expect(after.citations).toEqual([citation])
    expect(after.tools).toBe(before.tools)
    expect(after.activities).toBe(before.activities)
  })

  it('keeps tools/activities references for metadata-only events', () => {
    let messages = seedStreamingTurn()
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })
    const before = lastMessage(messages)

    const withCitations = applyStreamEvent(messages, { type: 'citations', sessionId: 's', citations: [{ url: 'https://docs.example', title: 'Docs' }] })
    expect(lastMessage(withCitations).tools).toBe(before.tools)
    expect(lastMessage(withCitations).activities).toBe(before.activities)
    expect(lastMessage(withCitations).citations).toEqual([{ url: 'https://docs.example', title: 'Docs' }])

    const withFiles = applyStreamEvent(withCitations, { type: 'input_file_sources', sessionId: 's', sources: [{ name: 'report.pdf' }] })
    expect(lastMessage(withFiles).tools).toBe(before.tools)
    expect(lastMessage(withFiles).activities).toBe(before.activities)
    expect(lastMessage(withFiles).fileSources).toEqual([{ name: 'report.pdf' }])

    const withUsage = applyStreamEvent(withFiles, {
      type: 'server_side_usage',
      sessionId: 's',
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 3, serverSideToolUsage: { SERVER_SIDE_TOOL_WEB_SEARCH: 1 } },
    })
    expect(lastMessage(withUsage).tools).toBe(before.tools)
    expect(lastMessage(withUsage).activities).toBe(before.activities)
    expect(lastMessage(withUsage).serverSideToolUsage).toEqual({ SERVER_SIDE_TOOL_WEB_SEARCH: 1 })
  })

  it('still anchors a new text activity on an empty delta before later tools', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, segment: 0, delta: '' })
    expect(lastMessage(messages).activities).toEqual([{ type: 'text', id: 'text:0:0', contentIndex: 0, segment: 0, content: '' }])
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-a', name: 'read', delta: '{}' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, segment: 0, delta: '中途结论' })
    const activities = lastMessage(messages).activities ?? []
    expect(activities.map(activity => activity.type)).toEqual(['text', 'tool'])
    expect(activities[0]).toMatchObject({ type: 'text', content: '中途结论' })
    expect(lastMessage(messages).content).toBe('中途结论')
  })

  it('keeps per-event content semantics across a mixed stream', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: '想' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 0, delta: '开' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 0, delta: '始' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 0, toolCallId: 'call-1', name: 'read', delta: '{"p":1}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'call-1', content: 'ok', isError: false })
    messages = applyStreamEvent(messages, { type: 'hosted_search', sessionId: 's', callId: 'ws_1', kind: 'web_search', phase: 'completed', query: 'q', sources: [{ url: 'https://x.example' }], outputIndex: 3 })
    messages = applyStreamEvent(messages, { type: 'citations', sessionId: 's', citations: [{ url: 'https://x.example', title: 'X' }] })
    messages = applyStreamEvent(messages, { type: 'input_file_sources', sessionId: 's', sources: [{ name: 'r.pdf' }] })
    messages = applyStreamEvent(messages, {
      type: 'server_side_usage',
      sessionId: 's',
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 3, serverSideToolUsage: { SERVER_SIDE_TOOL_WEB_SEARCH: 1 } },
    })
    const message = lastMessage(messages)
    expect(message.content).toBe('开始')
    expect(message.thinking).toBe('想')
    expect(message.tools?.map(tool => tool.id)).toEqual(['call-1', 'ws_1'])
    expect(message.tools?.[0]).toMatchObject({ id: 'call-1', finished: true, result: 'ok' })
    expect(message.tools?.[1]).toMatchObject({ id: 'ws_1', name: 'web_search', finished: true })
    expect(message.citations).toEqual([{ url: 'https://x.example', title: 'X' }])
    expect(message.fileSources).toEqual([{ name: 'r.pdf' }])
    expect(message.serverSideToolUsage).toEqual({ SERVER_SIDE_TOOL_WEB_SEARCH: 1 })
    // Insertion order preserved; finished tools reopen the pending placeholder,
    // and the metadata-only events after them leave activities untouched.
    expect((message.activities ?? []).map(activity => activity.type)).toEqual(['thinking', 'text', 'tool', 'tool', 'thinking'])
    expect(message.activities?.at(-1)).toMatchObject({ type: 'thinking', id: PENDING_THINKING_ID })
  })

  it('never mutates the previous message or its containers across a mixed burst', () => {
    const messages = seedStreamingTurn()
    const before = lastMessage(messages)
    const beforeSnapshot = structuredClone(before)
    let next = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '结论' })
    next = applyStreamEvent(next, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: '再看' })
    next = applyStreamEvent(next, { type: 'tool_call', sessionId: 's', toolCallId: 'read-c', name: 'read', delta: '{}' })
    next = applyStreamEvent(next, { type: 'tool_result', sessionId: 's', toolCallId: 'read-c', content: 'c' })
    next = applyStreamEvent(next, { type: 'citations', sessionId: 's', citations: [{ url: 'https://x.example' }] })
    expect(before).toEqual(beforeSnapshot)
    expect(messages).toHaveLength(1)
    expect(lastMessage(next)).toMatchObject({ content: '结论', thinking: '计划再看' })
  })
})
