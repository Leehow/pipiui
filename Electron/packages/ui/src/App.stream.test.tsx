// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// App imports browser-only panels; this reducer suite must not rely on xterm's layout implementation.
vi.mock('@xterm/xterm', () => ({ Terminal: class { buffer = { active: { viewportY: 0, baseY: 0 } }; options = {}; open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); onData() { return { dispose: vi.fn() } } onScroll() { return { dispose: vi.fn() } } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => cleanup())

import { applyStreamEvent, finishStreamingMessage, historyMessages, MessageView, type ChatMessage } from './App'
import type { HistoryEntry } from '@pipi/host-api'

describe('stream message reducer', () => {
  it('appends coalesced tool deltas to one tool and clears streaming on terminal status', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'plan' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 0, delta: 'answer' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read', name: 'read', delta: 'a' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read', name: 'read', delta: 'b' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read', content: 'ok' })
    expect(messages[0]).toMatchObject({ content: 'answer', thinking: 'plan', streaming: true, tools: [{ id: 'read', input: 'ab', result: 'ok', finished: true }] })
    expect(finishStreamingMessage(messages)[0].streaming).toBe(false)
  })

  it('renders the readable tool summary (bash · command) on the folded tool card', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'bash-1', name: 'bash', delta: '{"command":"ls -la","cwd":"/tmp"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'bash-1', content: 'total 0', isError: false })
    messages = finishStreamingMessage(messages)
    render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    // Outer "N 个步骤" card collapses when the turn settles; expand it to reveal the tool card.
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    const tool = screen.getByRole('button', { name: /bash · ls -la/ })
    expect(tool.getAttribute('aria-expanded')).toBe('false')
  })

  it('builds folded tool/turn messages from structured history entries', () => {
    const messages = historyMessages([
      { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'done', thinking: 'plan', tools: [{ id: 'call-1', name: 'bash', input: '{"command":"ls -la"}' }], timestamp: 2 },
      { id: 't1', role: 'tool', content: 'total 0', toolCallId: 'call-1', toolName: 'bash', timestamp: 3 },
    ])
    // The toolResult attaches to its card; the standalone row is dropped.
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      id: 'a1', role: 'assistant', content: 'done', thinking: 'plan',
      tools: [{ id: 'call-1', name: 'bash', input: '{"command":"ls -la"}', startedAt: 2, finished: true, result: 'total 0' }],
    })
  })

  it('renders history turns as folded cards with readable tool summaries', () => {
    const messages = historyMessages([
      { id: 'a1', role: 'assistant', content: '', thinking: 'plan', tools: [{ id: 'call-1', name: 'bash', input: '{"command":"ls -la"}' }], timestamp: 1 },
      { id: 't1', role: 'tool', content: 'total 0', toolCallId: 'call-1', toolName: 'bash', timestamp: 2 },
    ])
    render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    // A resumed turn renders as a collapsed "N 个步骤" chip, not flat text.
    const outer = screen.getByRole('button', { name: /2 个步骤/ })
    expect(outer.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(outer)
    // The tool card inside is also collapsed, with a readable bash · command summary.
    const tool = screen.getByRole('button', { name: /bash · ls -la/ })
    expect(tool.getAttribute('aria-expanded')).toBe('false')
  })

  it('marks finished even when the result content is empty (image-only results)', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'shot', name: 'browser', delta: '{"action":"screenshot"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'shot', content: '', isError: false })
    expect(messages[0].tools?.[0]).toMatchObject({ name: 'browser', input: '{"action":"screenshot"}', result: '', finished: true })
  })
})

describe('tool-only assistant turn coalescing (Swift finishedGroup parity)', () => {
  const toolEntry = (id: string, name: string, input: string): HistoryEntry => ({ id: `a-${id}`, role: 'assistant', content: '', tools: [{ id: `call-${id}`, name, input }], timestamp: 1 })
  const resultEntry = (id: string, content = 'ok'): HistoryEntry => ({ id: `r-${id}`, role: 'tool', content, toolCallId: `call-${id}`, toolName: 'bash', timestamp: 2 })

  it('merges 6 bash + 1 browser consecutive tool-only turns into one folded card with a counted summary', () => {
    const entries: HistoryEntry[] = [
      { id: 'u1', role: 'user', content: '改一下目录结构', timestamp: 0 },
      ...Array.from({ length: 6 }, (_, i) => toolEntry(`b${i + 1}`, 'bash', '{"command":"ls -la"}')),
      { id: 'a-b7', role: 'assistant', content: '', tools: [{ id: 'call-b7', name: 'browser', input: '{"action":"navigate","url":"http://localhost:5176"}' }], timestamp: 1 },
      ...Array.from({ length: 6 }, (_, i) => resultEntry(`b${i + 1}`)),
      resultEntry('b7', 'page loaded'),
    ]
    const messages = historyMessages(entries)
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '' })
    expect(messages[1].tools).toHaveLength(7)
    // Results attached to their own cards inside the merged turn.
    expect(messages[1].tools?.filter(tool => tool.result)).toHaveLength(7)
    render(<MessageView message={messages[1]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    // One folded summary card, collapsed by default, with the step count and the
    // repeated-tool count (bash ×6) instead of seven stacked "1 个步骤" cards.
    const outer = screen.getByRole('button', { name: /7 个步骤 · bash ×6/ })
    expect(outer.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(outer)
    expect(screen.getAllByRole('button', { name: /bash · ls -la/ })).toHaveLength(6)
    expect(screen.getByRole('button', { name: /browser · navigate http:\/\/localhost:5176/ })).toBeTruthy()
  })

  it('keeps a single tool-only turn as its own card (no merge)', () => {
    const messages = historyMessages([toolEntry('1', 'bash', '{"command":"ls -la"}'), resultEntry('1')])
    expect(messages).toHaveLength(1)
    expect(messages[0].tools).toHaveLength(1)
    render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getByRole('button', { name: /1 个步骤 · bash/ })).toBeTruthy()
  })

  it('does not merge tool-only turns across a text or thinking assistant message', () => {
    const messages = historyMessages([
      toolEntry('1', 'bash', '{"command":"ls -la"}'),
      { id: 'a-text', role: 'assistant', content: '我来看一下', thinking: 'plan', tools: [{ id: 'call-2', name: 'bash', input: '{"command":"pwd"}' }], timestamp: 1 },
      toolEntry('3', 'bash', '{"command":"git status"}'),
      resultEntry('1'),
      resultEntry('2', 'ok'),
      resultEntry('3', 'ok'),
    ])
    expect(messages).toHaveLength(3)
    expect(messages[0].tools).toHaveLength(1)
    expect(messages[1].tools).toHaveLength(1)
    expect(messages[1].thinking).toBe('plan')
    expect(messages[2].tools).toHaveLength(1)
  })
})
