// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, HistoryEntry, PipiHostAPI, StreamEvent } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'

beforeEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})

describe('active-turn waiting placeholder', () => {
  it('folds a host-driven turn (resumed/read-only session) once it settles', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    // A host-driven turn (not started by a UI send) streams…
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'welcome', toolCallId: 'bash-1', name: 'bash', delta: '{"command":"ls -la"}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'welcome', toolCallId: 'bash-1', content: 'ok', isError: false }) })
    const outer = await screen.findByRole('button', { name: /2 个步骤/ })
    expect(outer.getAttribute('aria-expanded')).toBe('true')
    expect(outer.textContent).toContain('运行中')
    expect(screen.getByRole('button', { name: /^Thinking/ }).closest('[data-activity-card="thinking"]')).toBeTruthy()

    // …and folds when the turn settles, even without a direct user send.
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.getByRole('button', { name: /1 个步骤/ }).getAttribute('aria-expanded')).toBe('false'))
  })

  it('shows the first-response wait for host-driven turns, keeps it through thinking/tool, hides on first text, and cleans up on settle', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    // Layout has no running subagent fixtures, so the tail indicator is unambiguous.
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('aria-current')).toBe('true'))
    await waitFor(() => expect(listener).toBeDefined())

    // A host-driven turn (resumed/read-only session, queue dispatch, background
    // dispatch) shows the first-response wait even though the UI never sent a prompt.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    const placeholder = await screen.findByTestId('waiting-placeholder')
    expect(placeholder.getAttribute('data-phase')).toBe('awaiting')
    // The turn owns the Composer too: the stop control replaces the send button.
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)

    // Thinking/tool keep the wait visible and move its phase.
    act(() => { listener?.({ type: 'thinking', sessionId: 'layout', contentIndex: 0, delta: 'plan' }) })
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('thinking')
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'bash-1', name: 'bash', delta: '{"command":"ls -la"}' }) })
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('tool')
    expect(screen.getByTestId('waiting-placeholder').textContent).toContain('bash · ls -la')

    // First real text ends the first-response wait, but the turn is still
    // streaming: the Composer keeps its stop control until settled/stopped.
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: 'Hello' }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)

    // settled cleans up streaming + waiting and folds the streaming message.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryAllByLabelText('停止生成')).toHaveLength(0))
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByRole('button', { name: /个步骤/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('starts the wait for a local send and routes the inline stop to host.stop', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const stop = vi.fn(async () => listener?.({ type: 'status', sessionId: 'layout', status: 'stopped' }))
    const host: PipiHostAPI = { ...base, sendPrompt: vi.fn(async () => undefined), stop, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())
    const input = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    await waitFor(() => expect(input.disabled).toBe(false), { timeout: 5000 })

    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    // The user's own send establishes the first-response wait (phase awaiting)
    // immediately, before any host status event.
    const waiting = await screen.findByTestId('waiting-placeholder')
    expect(waiting.getAttribute('data-phase')).toBe('awaiting')
    // The inline stop delegates to host.stop; the stopped status cleans up.
    fireEvent.click(screen.getByTestId('waiting-stop'))
    await waitFor(() => expect(stop).toHaveBeenCalledWith('layout'))
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
  })

  it('restores streaming + waiting when switching back to an observed-running session', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    // A host-driven turn starts on layout while it is selected.
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    expect(await screen.findByTestId('waiting-placeholder')).toBeTruthy()

    // Switching away clears the live state.
    fireEvent.click(container.querySelector('[data-session-id="tool-burst"]')!)
    await waitFor(() => expect(container.querySelector('[data-session-id="tool-burst"]')?.getAttribute('aria-current')).toBe('true'))
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
    expect(screen.queryAllByLabelText('停止生成')).toHaveLength(0)

    // Switching back to the still-running session restores streaming + waiting
    // from the observed status map — no replay protocol, no new status event.
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(screen.getByTestId('waiting-placeholder')).toBeTruthy())
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('awaiting')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    // The loaded history is present alongside the restored live state.
    expect(screen.getByText('左栏宽度要能持久化。')).toBeTruthy()
  })

  it('shows a continuing wait for queued follow-ups instead of a second first-response placeholder', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    // Layout has a user-only history, so a fresh host-driven turn owns the wait.
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    expect(await screen.findByTestId('waiting-placeholder')).toBeTruthy()

    // A live tool card is visible output; a follow-up 'started' while the turn is
    // still active must not add a second placeholder (the ref guard anchors it).
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'bash-1', name: 'bash', delta: '{"command":"ls -la"}' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    expect(screen.queryAllByTestId('waiting-placeholder')).toHaveLength(1)

    // First text ends the first-token wait; settle ends the turn.
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '第一轮答复' }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryAllByLabelText('停止生成')).toHaveLength(0))

    // A queued follow-up now dispatches: the transcript already shows assistant
    // output, so the first-response "等待第一个响应" copy must not return. The
    // new turn still needs a reason — otherwise the composer only says 生成中.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    const followUpWait = await screen.findByTestId('waiting-placeholder')
    expect(followUpWait.getAttribute('data-phase')).toBe('continuing')
    expect(followUpWait.textContent).toContain('等待模型响应')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)

    // The follow-up streams its own text and settles cleanly.
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '第二轮答复' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryAllByLabelText('停止生成')).toHaveLength(0))
  })

  it('keeps a stable subagent tail indicator while workers run, even after the main turn settles', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const agentListeners = new Set<(event: AgentEvent) => void>()
    const host: PipiHostAPI = {
      ...base,
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
      subscribeAgents: agentListener => { agentListeners.add(agentListener); return () => { agentListeners.delete(agentListener) } }
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(agentListeners.size).toBeGreaterThan(0))

    // welcome's fixture 'research' worker is running: the tail indicator appears.
    const placeholder = await screen.findByTestId('waiting-placeholder')
    expect(placeholder.getAttribute('data-phase')).toBe('tool')
    expect(placeholder.textContent).toContain('1 个子任务执行中')
    // It is not a main turn: no stop control.
    expect(placeholder.querySelector('[data-testid="waiting-stop"]')).toBeNull()

    // A settled main turn with visible text does not remove it.
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })
    act(() => { listener?.({ type: 'text', sessionId: 'welcome', contentIndex: 0, delta: '主回复' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.getByText(/主回复/)).toBeTruthy())
    expect(screen.getByTestId('waiting-placeholder').textContent).toContain('1 个子任务执行中')

    // The elapsed readout ticks live (anchored at the run start).
    await waitFor(() => expect(screen.getByTestId('waiting-elapsed').textContent).toContain('已用时'), { timeout: 4000 })

    // Agent terminal removes the indicator.
    act(() => { for (const push of agentListeners) push({ type: 'agent', agent: { agentId: 'research', runId: 'mock-1', sessionId: 'welcome', name: 'explore', role: 'explore', title: '调研 UI', task: '调研 Electron UI 结构', state: 'ok', createdAt: Date.now() - 20_000 } }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
  })

  it('reopens a thinking wait after the last tool finishes so a silent next completion is not a blank 生成中', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '先派三个探索' }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())

    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'status-1', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'status-1', content: 'ok', isError: false }) })

    const wait = await screen.findByTestId('waiting-placeholder')
    expect(wait.getAttribute('data-phase')).toBe('thinking')
    expect(wait.textContent).toContain('模型正在思考')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    const liveThinking = screen.getByRole('button', { name: /^Thinking/ })
    expect(liveThinking.closest('[data-activity-card="thinking"]')).toBeTruthy()
    expect(liveThinking.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /个步骤/ }).textContent).toContain('运行中')
    expect(screen.getByRole('button', { name: /个步骤/ }).textContent).not.toContain('已完成')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('running')

    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '设计方案可以定了' }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
  })

  it('keeps the tool wait until every in-flight tool has finished', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'a', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'b', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'a', content: 'ok', isError: false }) })
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('tool')

    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'b', content: 'ok', isError: false }) })
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('thinking')
    expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型正在思考')
  })

  it('keeps the silent next-hop thinking card after a history refresh when the last worker finishes', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const agentListeners = new Set<(event: AgentEvent) => void>()
    let layoutHistory: HistoryEntry[] = [
      { id: 'u2', role: 'user', content: '给我个方案', timestamp: 1 },
    ]
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
      subscribeAgents: callback => { agentListeners.add(callback); return () => { agentListeners.delete(callback) } },
      listAgents: async sessionId => sessionId && sessionId !== 'layout' ? base.listAgents(sessionId) : [],
      getSessionHistory: async sessionId => sessionId === 'layout' ? layoutHistory : base.getSessionHistory(sessionId),
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('aria-current')).toBe('true'))
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['[subagent-done] agentId=a1 name=explore ok=true'] }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '两路已结束，直接取回完整报告。' }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'status-1', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'status-2', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'status-1', content: 'ok', isError: false }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'status-2', content: 'ok', isError: false }) })

    await waitFor(() => {
      expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型正在思考')
      expect(screen.getByRole('button', { name: /个步骤/ }).textContent).toContain('运行中')
    })

    layoutHistory = [
      { id: 'u2', role: 'user', content: '给我个方案', timestamp: 1 },
      {
        id: 'a-tools',
        role: 'assistant',
        content: '两路已结束，直接取回完整报告。',
        thinking: '先取回报告',
        tools: [
          { id: 'status-1', name: 'subagent_status', input: '{}' },
          { id: 'status-2', name: 'subagent_status', input: '{}' },
        ],
        timestamp: 2,
      },
      { id: 'r1', role: 'tool', content: 'ok', toolCallId: 'status-1', toolName: 'subagent_status', timestamp: 3 },
      { id: 'r2', role: 'tool', content: 'ok', toolCallId: 'status-2', toolName: 'subagent_status', timestamp: 4 },
    ]

    const worker = {
      agentId: 'explore-last',
      runId: 'run-1',
      sessionId: 'layout',
      name: 'explore',
      role: 'explore' as const,
      title: '调研',
      task: '调研',
      state: 'running' as const,
      createdAt: Date.now() - 20_000,
    }
    act(() => { for (const push of agentListeners) push({ type: 'agent', agent: worker }) })
    await waitFor(() => expect(agentListeners.size).toBeGreaterThan(0))
    act(() => { for (const push of agentListeners) push({ type: 'agent', agent: { ...worker, state: 'ok', endedAt: Date.now() } }) })

    await waitFor(() => {
      expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型正在思考')
      const steps = screen.getByRole('button', { name: /个步骤/ })
      expect(steps.textContent).toContain('运行中')
      expect(steps.textContent).not.toContain('已完成')
    })
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
  })
})
