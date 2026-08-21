// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// App imports browser-only panels; this reducer suite must not rely on xterm's layout implementation.
vi.mock('@xterm/xterm', () => ({ Terminal: class { buffer = { active: { viewportY: 0, baseY: 0 } }; options = {}; open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); onData() { return { dispose: vi.fn() } } onScroll() { return { dispose: vi.fn() } } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => cleanup())

import { mergeAgentSummary, selectedSessionAgentSummaries } from './App'
import { MessageView } from './Transcript'
import { applyStreamEvent, finishStreamingMessage, historyMessages, type ChatMessage, type TranscriptActivity } from './transcript-model'
import { LiveSubagentBindingProvider } from './LiveSubagentBinding'
import { projectLiveSubagents } from './live-subagent-projection'
import type { AgentSummary, HistoryEntry } from '@pipi/host-api'

function activityLabel(activity: TranscriptActivity): string {
  if (activity.type === 'thinking') return `thinking:${activity.content}`
  if (activity.type === 'text') return `text:${activity.content}`
  return `tool:${activity.tool.name}`
}

function renderWithAgents(view: JSX.Element, agents: AgentSummary[], sessionId = 's') {
  const host = { listAgents: vi.fn(() => ({ then: (resolve: (value: AgentSummary[]) => void) => { resolve(agents); return { catch: () => undefined } } })), subscribeAgents: vi.fn(() => () => undefined) } as unknown as import('@pipi/host-api').PipiHostAPI
  return render(<LiveSubagentBindingProvider host={host} sessionId={sessionId}>{view}</LiveSubagentBindingProvider>)
}

describe('stream message reducer', () => {
  it('preserves live thinking/tool chronology and exposes the current tool without disclosure semantics', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'inspect' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 1, toolCallId: 'read-1', name: 'read', delta: '{"path":"src/App.tsx"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-1', content: 'source' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 2, delta: 'verify' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 3, toolCallId: 'bash-1', name: 'bash', delta: '{"command":"npm test"}' })

    expect(messages[0].activities?.map(activityLabel)).toEqual([
      'thinking:inspect', 'tool:read', 'thinking:verify', 'tool:bash',
    ])

    const { rerender } = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const completed = screen.getByRole('button', { name: /3 个步骤/ })
    fireEvent.click(completed)
    expect(completed.getAttribute('aria-expanded')).toBe('false')
    const active = screen.getByTestId('active-tool')
    expect(active.querySelector('b')?.textContent).toBe('bash · npm test')
    expect(active.textContent).toContain('运行中')
    expect(active.querySelector('[aria-expanded]')).toBeNull()
    expect(active.querySelector('.activity-chevron')).toBeNull()
    expect(active.querySelector('.activity-details')).toBeNull()
    expect(active.querySelector('.tool-io')).toBeNull()

    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 3, toolCallId: 'bash-1', name: 'bash', delta: ' ' })
    rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getByRole('button', { name: /3 个步骤/ }).getAttribute('aria-expanded')).toBe('false')

    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'bash-1', content: 'passed' })
    rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const streamingCompleted = screen.getByRole('button', { name: /5 个步骤/ })
    expect(streamingCompleted.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(streamingCompleted)
    const finishedTool = screen.getByRole('button', { name: /bash · npm test/ })
    expect(finishedTool.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('passed')).toBeNull()
    expect(screen.getByRole('button', { name: /5 个步骤/ }).textContent).toContain('运行中')
    expect(screen.getAllByRole('button', { name: /^Thinking/ }).some(button => button.closest('[data-activity-card="thinking"]'))).toBe(true)

    messages = finishStreamingMessage(messages)
    rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const settled = screen.getByRole('button', { name: /4 个步骤/ })
    expect(settled.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(settled)
    expect([...document.querySelectorAll('.assistant-transcript-content > .activity-card > .activity-details > .activity-card')].map(card => card.getAttribute('data-activity-card'))).toEqual([
      'thinking', 'tool', 'thinking', 'tool',
    ])
  })

  it('renders restarted-index rounds in chronological order and keeps mid-turn text between groups', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: 'inspect A' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 0, delta: '先读 A' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 0, toolCallId: 'read-a', name: 'read', delta: '{"path":"A.tsx"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-a', content: 'a' })
    messages = applyStreamEvent(messages, { type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: 'inspect B' })
    messages = applyStreamEvent(messages, { type: 'text', sessionId: 's', contentIndex: 1, segment: 1, delta: '再读 B' })
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', contentIndex: 2, segment: 1, toolCallId: 'read-b', name: 'read', delta: '{"path":"B.tsx"}' })
    messages = finishStreamingMessage(messages)

    render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    for (const button of screen.getAllByRole('button', { name: /个步骤/ })) fireEvent.click(button)
    const firstText = screen.getByText('先读 A')
    const secondText = screen.getByText('再读 B')
    const thinkings = screen.getAllByRole('button', { name: /^Thinking/ })
    const tools = screen.getAllByRole('button', { name: /read / })
    expect(thinkings).toHaveLength(2)
    expect(tools).toHaveLength(2)
    expect(firstText.compareDocumentPosition(thinkings[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(firstText.compareDocumentPosition(secondText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(thinkings[0].compareDocumentPosition(tools[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tools[0].compareDocumentPosition(thinkings[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows live thinking text instead of holding it behind a collapsed card', () => {
    const messages = applyStreamEvent([], { type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'I will read QuotaPill next' })
    render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getByText('I will read QuotaPill next')).toBeTruthy()
  })

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

  it('renders the readable tool summary (bash <command>) on the folded tool card', () => {
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
      tools: [{ id: 'call-1', name: 'bash', input: '{"command":"ls -la"}', startedAt: 2, finishedAt: 3, finished: true, result: 'total 0' }],
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
    // The tool card inside is also collapsed, with a readable bash <command> summary.
    const tool = screen.getByRole('button', { name: /bash · ls -la/ })
    expect(tool.getAttribute('aria-expanded')).toBe('false')
  })

  it('marks finished even when the result content is empty (image-only results)', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'shot', name: 'browser', delta: '{"action":"screenshot"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'shot', content: '', isError: false })
    expect(messages[0].tools?.[0]).toMatchObject({ name: 'browser', input: '{"action":"screenshot"}', result: '', finished: true })
  })

  it('freezes a completed tool duration at the tool-result timestamp', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(10_000)
      let messages: ChatMessage[] = []
      messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'read-1', name: 'read', delta: '{"path":"README.md"}' })
      vi.setSystemTime(11_400)
      messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'read-1', content: 'ok' })
      messages = finishStreamingMessage(messages)

      const view = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
      fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
      expect(screen.getByRole('button', { name: /read.*README\.md/ }).textContent).toContain('完成 · 1s')

      vi.setSystemTime(71_400)
      const rerendered: ChatMessage = {
        ...messages[0],
        tools: messages[0].tools?.map(tool => ({ ...tool })),
        activities: messages[0].activities?.map(activity => activity.type === 'tool'
          ? { ...activity, tool: { ...activity.tool } }
          : { ...activity }),
      }
      view.rerender(<MessageView message={rerendered} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
      expect(screen.getByRole('button', { name: /read.*README\.md/ }).textContent).toContain('完成 · 1s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a terminal provider error as a visible bubble instead of an empty assistant turn', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'error', sessionId: 's', content: "Codex error: Invalid schema for function 'subagent': ..." })
    expect(messages[0]).toMatchObject({ role: 'assistant', content: '', error: "Codex error: Invalid schema for function 'subagent': ..." })
    const view = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const bubble = screen.getByTestId('assistant-turn-error')
    expect(bubble.getAttribute('role')).toBe('alert')
    expect(bubble.textContent).toContain("Codex error: Invalid schema for function 'subagent': ...")
    expect(screen.getByText("Codex error: Invalid schema for function 'subagent': ...", { selector: '.assistant-turn-error-message' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭错误提示' })).toBeTruthy()
    expect(screen.getByTestId('assistant-transcript-content').textContent ?? '').not.toBe('')
    view.unmount()
  })
})

describe('assistant activity turn coalescing (Swift finishedGroup parity)', () => {
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

  it('merges consecutive thinking + tool rounds in chronological order, then appends the final text', () => {
    const messages = historyMessages([
      { id: 'u1', role: 'user', content: '检查并修改仓库', timestamp: 0 },
      { id: 'a-read', role: 'assistant', content: '', thinking: '先读取文件', tools: [{ id: 'call-read', name: 'read', input: '{"path":"src/App.tsx"}' }], timestamp: 1 },
      { id: 'r-read', role: 'tool', content: '', toolCallId: 'call-read', toolName: 'read', images: [{ data: 'image-data', mimeType: 'image/png' }], timestamp: 2 },
      { id: 'a-git', role: 'assistant', content: '', thinking: '再确认改动范围', tools: [{ id: 'call-git', name: 'git', input: '{"command":"status"}' }], timestamp: 3 },
      { id: 'r-git', role: 'tool', content: 'dirty', toolCallId: 'call-git', toolName: 'git', isError: true, timestamp: 4 },
      { id: 'a-terminal', role: 'assistant', content: '', thinking: '最后运行验证', tools: [{ id: 'call-terminal', name: 'terminal', input: '{"command":"npm test"}' }], timestamp: 5 },
      { id: 'r-terminal', role: 'tool', content: 'passed', toolCallId: 'call-terminal', toolName: 'terminal', timestamp: 6 },
      { id: 'a-final', role: 'assistant', content: '验证通过。', timestamp: 7 },
    ])
    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({ id: 'a-final', content: '验证通过。', timestamp: 7 })
    expect(messages[1].activities?.map(activityLabel)).toEqual([
      'thinking:先读取文件', 'tool:read',
      'thinking:再确认改动范围', 'tool:git',
      'thinking:最后运行验证', 'tool:terminal',
    ])
    expect(messages[1].tools?.[0]).toMatchObject({ result: '', images: [{ data: 'image-data', mimeType: 'image/png' }] })
    expect(messages[1].tools?.[1]).toMatchObject({ result: 'dirty', error: true })

    const { container } = render(<MessageView message={messages[1]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getAllByRole('button', { name: /个步骤/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /6 个步骤/ }))
    const detailKinds = [...container.querySelectorAll('.assistant-transcript-content > .activity-card > .activity-details > .activity-card')]
      .map(card => card.getAttribute('data-activity-card'))
    expect(detailKinds).toEqual(['thinking', 'tool', 'thinking', 'tool', 'thinking', 'tool'])
  })

  it('restores activity chronology captured inside one assistant history entry', () => {
    const messages = historyMessages([{
      id: 'a-ordered', role: 'assistant', content: 'done', timestamp: 1,
      thinking: 'inspectverify',
      tools: [
        { id: 'call-read', name: 'read', input: '{"path":"src/App.tsx"}' },
        { id: 'call-bash', name: 'bash', input: '{"command":"npm test"}' },
      ],
      activities: [
        { type: 'thinking', contentIndex: 0, content: 'inspect' },
        { type: 'tool', contentIndex: 1, tool: { id: 'call-read', name: 'read', input: '{"path":"src/App.tsx"}' } },
        { type: 'thinking', contentIndex: 2, content: 'verify' },
        { type: 'tool', contentIndex: 3, tool: { id: 'call-bash', name: 'bash', input: '{"command":"npm test"}' } },
      ],
    } as HistoryEntry])

    expect(messages[0].activities?.map(activityLabel)).toEqual([
      'thinking:inspect', 'tool:read', 'thinking:verify', 'tool:bash',
    ])
  })

  it('does not merge activity packages across assistant text or user boundaries', () => {
    const messages = historyMessages([
      toolEntry('1', 'bash', '{"command":"ls -la"}'),
      { id: 'a-text', role: 'assistant', content: '第一段已完成', timestamp: 2 },
      toolEntry('2', 'bash', '{"command":"pwd"}'),
      { id: 'u2', role: 'user', content: '继续', timestamp: 3 },
      toolEntry('3', 'bash', '{"command":"git status"}'),
    ])
    expect(messages).toHaveLength(4)
    expect(messages[0]).toMatchObject({ role: 'assistant', content: '第一段已完成' })
    expect(messages[0].tools).toHaveLength(1)
    expect(messages[1].tools).toHaveLength(1)
    expect(messages[2]).toMatchObject({ role: 'user', content: '继续' })
    expect(messages[3].tools).toHaveLength(1)
  })
})

describe('subagent tool card stays live while linked workers run', () => {
  const agent = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({ agentId: 'a1', runId: 'r1', name: 'general-purpose', task: '调研', state: 'running', sessionId: 's', toolCallId: 'sub-call-1', parentId: null, depth: 1, ...overrides })
  const dispatch = (_agents: AgentSummary[]): ChatMessage[] => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'sub-call-1', name: 'subagent', delta: '{"task":"research"}' })
    // The boss settles immediately with the dispatch ack; the worker keeps going.
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'sub-call-1', content: 'Started background agent(s): a1' })
    return finishStreamingMessage(messages)
  }

  it('keeps the card running while a linked worker runs, then shows 完成 once it settles', () => {
    const running = dispatch([agent()])
    // Durable tool completion is independent from live child presentation.
    expect(running[0].tools?.[0]).toMatchObject({ name: 'subagent', finished: true })
    renderWithAgents(<MessageView message={running[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />, [agent()])
    const liveCard = screen.getByTestId('subagent-tool-card')
    expect(liveCard.textContent).toContain('共 1 · 运行 1 · 完成 0 · 失败 0')
    expect(liveCard.querySelector('.agent-spinner')).toBeTruthy()
    expect(liveCard.textContent).toContain('思考中…')
    expect(liveCard.textContent).not.toContain('完成 ·')
    cleanup()

    const ok = dispatch([agent({ state: 'ok', turns: 3 })])
    expect(ok[0].tools?.[0]?.finished).toBe(true)
    renderWithAgents(<MessageView message={ok[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />, [agent({ state: 'ok', turns: 3 })])
    // The worker settled, so the outer card collapsed again; expand to read the card.
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    const doneCard = screen.getByTestId('subagent-tool-card')
    expect(doneCard.querySelector('.agent-spinner')).toBeFalsy()
    expect(doneCard.textContent).toContain('共 1 · 运行 0 · 完成 1 · 失败 0')
    expect(doneCard.textContent).toContain('完成')
  })

  it('keeps a background acknowledgement dispatched until its exact worker START arrives', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'sub-call-1', name: 'subagent', delta: '{"task":"调研"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'sub-call-1', content: 'Started background agent(s) (1).\n\n- agentId=a1 name=general-purpose task=调研' })
    messages = finishStreamingMessage(messages)
    expect(messages[0].tools?.[0]).toMatchObject({ finished: true, dispatched: true })
    renderWithAgents(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />, [])
    const pending = screen.getByRole('button', { name: /子任务/ })
    expect(pending.textContent).toContain('已派发')
    expect(pending.textContent).not.toContain('完成')
    cleanup()

    renderWithAgents(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />, [agent()])
    expect(screen.getByTestId('subagent-tool-card').textContent).toContain('运行 1')
  })

  it('shows error and linked terminal failures before completion semantics', () => {
    let errored: ChatMessage[] = []
    errored = applyStreamEvent(errored, { type: 'tool_call', sessionId: 's', toolCallId: 'sub-error', name: 'subagent', delta: '{"task":"派发"}' })
    errored = applyStreamEvent(errored, { type: 'tool_result', sessionId: 's', toolCallId: 'sub-error', content: 'validation failed', isError: true })
    errored = finishStreamingMessage(errored)
    render(<MessageView message={errored[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    const toolError = screen.getByRole('button', { name: /子任务/ })
    expect(toolError.textContent).toContain('失败')
    expect(toolError.textContent).not.toContain('完成')
    cleanup()

    const failed = dispatch([agent({ state: 'failed', title: '核对生命周期' })])
    renderWithAgents(<MessageView message={failed[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />, [agent({ state: 'failed', title: '核对生命周期' })])
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    const linked = screen.getByTestId('subagent-tool-card')
    expect(linked.querySelector('.activity-status')?.textContent).not.toBe('✓')
    expect(linked.textContent).toContain('失败 1')
    expect(linked.textContent).toContain('核对生命周期')
    expect(linked.textContent).not.toContain('general-purpose')
  })

  it('renders a compact failed notice as failure on both the outer and tool cards', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'sub-failed', name: 'subagent', delta: '{"task":"核对生命周期"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'sub-failed', content: 'subagent task finished · general-purpose · failed · cost ¥0.05' })
    messages = finishStreamingMessage(messages)

    render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const outer = screen.getByRole('button', { name: /1 个步骤/ })
    expect(outer.querySelector('.activity-status')?.textContent).toBe('×')
    expect(outer.textContent).toContain('失败')
    fireEvent.click(outer)
    const tool = screen.getByRole('button', { name: /子任务/ })
    expect(tool.querySelector('.activity-status')?.textContent).toBe('×')
    expect(tool.textContent).toContain('失败')
    expect(tool.textContent).toContain('核对生命周期')
    expect(tool.textContent).not.toContain('general-purpose')
  })

  it('renders a standalone compact failed notice with a failure indicator', () => {
    render(<MessageView message={{ id: 'legacy-failed', role: 'tool', content: 'subagent task finished · general-purpose · failed · cost ¥0.05' }} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)

    const notice = screen.getByRole('button', { name: /general-purpose/ })
    expect(notice.querySelector('.activity-status')?.textContent).toBe('×')
    expect(notice.textContent).toContain('失败')
  })

  it('walks descendants through parentId and treats stalled workers as active', () => {
    const linked = [
      agent({ agentId: 'boss', state: 'ok' }),
      agent({ agentId: 'child', state: 'stalled', toolCallId: undefined, parentId: 'boss', depth: 2 }),
    ]
    expect(projectLiveSubagents({ id: 'sub-call-1' }, 's', linked).runningCount).toBe(1)
  })

  it('resumes history with an unfinished subagent tool while linked workers still run', () => {
    const messages = historyMessages([
      { id: 'a1', role: 'assistant', content: '', thinking: 'plan', tools: [{ id: 'call-1', name: 'subagent', input: '{"task":"research"}' }], timestamp: 1 },
      { id: 't1', role: 'tool', content: 'Started background agent(s): a1', toolCallId: 'call-1', toolName: 'subagent', timestamp: 2 },
    ])
    expect(messages[0].tools?.[0]?.finished).toBe(true)
    const settled = historyMessages([
      { id: 'a1', role: 'assistant', content: '', thinking: 'plan', tools: [{ id: 'call-1', name: 'subagent', input: '{"task":"research"}' }], timestamp: 1 },
      { id: 't1', role: 'tool', content: 'Started background agent(s): a1', toolCallId: 'call-1', toolName: 'subagent', timestamp: 2 },
    ])
    expect(settled[0].tools?.[0]?.finished).toBe(true)
  })
})

describe('session-scoped agent projection', () => {
  it('keeps duplicate agentId/toolCallId rows isolated across an A→B switch', () => {
    const a: AgentSummary = { agentId: 'worker', runId: 'a-run', sessionId: 'A', toolCallId: 'tc1', name: 'general-purpose', task: 'A task', state: 'running' }
    const b: AgentSummary = { agentId: 'worker', runId: 'b-run', sessionId: 'B', toolCallId: 'tc1', name: 'reviewer', task: 'B task', state: 'failed' }
    const merged = mergeAgentSummary([a, b], { ...a, state: 'ok' })

    expect(merged).toHaveLength(2)
    expect(selectedSessionAgentSummaries(merged, 'A')).toMatchObject([{ runId: 'a-run', state: 'ok', task: 'A task' }])
    const selectedB = selectedSessionAgentSummaries(merged, 'B')
    expect(selectedB).toMatchObject([{ runId: 'b-run', state: 'failed', task: 'B task' }])
    expect(projectLiveSubagents({ id: 'tc1' }, 'B', selectedB).agents.map(agent => agent.sessionId)).toEqual(['B'])
  })
})

describe('active tool-card semantics', () => {
  it('shows an unfinished ordinary tool as a non-disclosure row, then folds it after completion', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'bash-1', name: 'bash', delta: '{"command":"ls -la"}' })
    const view = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    // A lone current tool has no completed-step group yet and must not pretend
    // to be a disclosure: its real identity and running state stay visible.
    const active = screen.getByTestId('active-tool')
    expect(active.querySelector('b')?.textContent).toBe('bash · ls -la')
    expect(active.textContent).toContain('运行中')
    expect(active.querySelector('[aria-expanded]')).toBeNull()
    expect(screen.queryByRole('button', { name: /1 个步骤/ })).toBeNull()
    // Once the tool finishes it joins the still-live completed-step group.
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'bash-1', content: 'ok' })
    view.rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.queryByTestId('active-tool')).toBeNull()
    expect(screen.getByRole('button', { name: /2 个步骤/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /bash · ls -la/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /2 个步骤/ }).textContent).toContain('运行中')
    expect(screen.getByRole('button', { name: /^Thinking/ }).closest('[data-activity-card="thinking"]')).toBeTruthy()
    // Settled: both the outer card and the finished tool fold back to collapsed.
    messages = finishStreamingMessage(messages)
    view.rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getByRole('button', { name: /1 个步骤/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    expect(screen.getByRole('button', { name: /bash · ls -la/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('does not light an unrelated historical subagent card from a session-global running count', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'sub-1', name: 'subagent', delta: '{"name":"explore"}' })
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'sub-1', content: 'ok', isError: false })
    messages = finishStreamingMessage(messages)
    const view = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const outer = screen.getByRole('button', { name: /1 个步骤/ })
    expect(outer.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(outer)
    const sub = screen.getByRole('button', { name: /子任务/ })
    expect(sub.textContent).not.toContain('运行中 · 2 个子任务')
    expect(sub.textContent).toContain('完成')
    view.unmount()
  })

  it('shows growing write token estimates then finished +tokens', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'w1', name: 'write', delta: '{"path":"a.ts","content":"abcd' })
    const view = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const first = screen.getByTestId('active-tool').textContent ?? ''
    expect(first).toMatch(/~1 tokens/)
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'w1', name: 'write', delta: 'efghijklmno"}' })
    view.rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    const second = screen.getByTestId('active-tool').textContent ?? ''
    expect(second).toMatch(/~4 tokens/)
    expect(second).not.toBe(first)
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'w1', content: 'ok' })
    messages = finishStreamingMessage(messages)
    view.rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    const writeCard = screen.getByRole('button', { name: /write · a.ts/ }).textContent ?? ''
    expect(writeCard).toMatch(/\+1/)
    expect(writeCard).not.toMatch(/\u2212/)
    view.unmount()
  })

  it('shows growing edit token estimates then +/−', () => {
    let messages: ChatMessage[] = []
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'e1', name: 'edit', delta: '{"path":"b.ts","edits":[{"oldText":"aa","newText":"bbbb' })
    const view = render(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getByTestId('active-tool').textContent).toMatch(/~1 tokens/)
    messages = applyStreamEvent(messages, { type: 'tool_call', sessionId: 's', toolCallId: 'e1', name: 'edit', delta: 'cccc"}]}' })
    view.rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    expect(screen.getByTestId('active-tool').textContent).toMatch(/~2 tokens/)
    messages = applyStreamEvent(messages, { type: 'tool_result', sessionId: 's', toolCallId: 'e1', content: 'ok' })
    messages = finishStreamingMessage(messages)
    view.rerender(<MessageView message={messages[0]} onCopy={() => Promise.resolve()} onResend={() => undefined} resendDisabled={false} copied={false} />)
    fireEvent.click(screen.getByRole('button', { name: /1 个步骤/ }))
    const card = screen.getByRole('button', { name: /edit · b.ts/ }).textContent ?? ''
    expect(card).toMatch(/\+1/)
    expect(card).toMatch(/\u22121/)
    view.unmount()
  })
})
