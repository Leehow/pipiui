// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, StreamEvent } from '@pipi/host-api'

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
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})

describe('settled turn stays idle after a late streaming status', () => {
  it('does not bind an in-flight status from the previously selected session to the terminal session', async () => {
    let selectedListener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      getProjectPaths: async () => ['/fixture'],
      listProjects: async () => [{ id: 'fixture', name: 'Fixture', path: '/fixture' }],
      listSessions: async () => [
        { id: 'active-session', projectId: 'fixture', name: 'Active session', updatedAt: 2 },
        { id: 'terminal-session', projectId: 'fixture', name: 'Terminal session', updatedAt: 1 },
      ],
      getSessionHistory: async sessionId => sessionId === 'terminal-session'
        ? [{ id: 'terminal-answer', role: 'assistant', content: 'Durable terminal answer', timestamp: 1 }]
        : [],
      getSidebarSessionPreferences: async () => ({ pinnedSessionIds: [], archivedSessionIds: [], archivedSessionTimestamps: {}, orderedSessionIds: [], sessionOrderVersion: 2 }),
      subscribeStream: (_sessionId, callback) => { selectedListener = callback; return () => undefined },
    }
    const { container } = render(<App host={host} />)
    await screen.findByText('Active session')
    await waitFor(() => expect(selectedListener).toBeDefined())

    fireEvent.click(container.querySelector('[data-session-id="terminal-session"]')!)
    await screen.findByText('Durable terminal answer')
    await waitFor(() => expect(document.title).toBe('Terminal session'))

    // The IPC transport filters subscriptions by session, but an event which
    // already entered the renderer callback may finish after selection changed.
    act(() => {
      selectedListener?.({ type: 'status', sessionId: 'active-session', status: 'started', pendingFollowUps: ['still running'] })
    })

    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('does not reopen the composer as busy when queue_update arrives after settle', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '打包结果回来了' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'streaming' }) })
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('names a follow-up wait after prior assistant output instead of claiming first response', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '第一轮答复' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    const followUpWait = await screen.findByTestId('waiting-placeholder')
    expect(followUpWait.getAttribute('data-phase')).toBe('continuing')
    expect(followUpWait.textContent).toContain('等待模型响应')
  })

  it('does not reopen a closed transcript after remount when a bare started arrives', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="tool-burst"]')!)
    // Closed history ends on a finished assistant; App restart resets
    // turnJustSettledRef, then pi/ensure can emit a bare started.
    await screen.findByText('调整完成：src 布局就位，浏览器确认无回归。')
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'tool-burst', status: 'started' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('does not reopen a settled turn on a bare started with no follow-up prompt', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '结论已经写完了' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByText('结论已经写完了')).toBeTruthy()

    // Production: a late/duplicate agent_start after settle has empty followUps
    // and no new user row. Reopening here is the "已完成还在等待模型响应" ghost turn.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('reopens a live thinking wait when the next started follows a tool-bearing assistant', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'read-1', name: 'read', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'read-1', content: 'ok', isError: false }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    // Grok/xhigh often settles the assistant message that ended on tools, then
    // starts the next completion with no thinking_delta and no new user row.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    const wait = await screen.findByTestId('waiting-placeholder')
    expect(wait.textContent).toMatch(/思考|等待模型/)
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('running')
  })

  it('shows a live [subagent-done] card and names the follow-up wait', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '架构判断写完了' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'done-1', content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n找到了设置页' }) })
    expect((await screen.findByTestId('subagent-signal-card')).getAttribute('data-signal-kind')).toBe('done')

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    const followUpWait = await screen.findByTestId('waiting-placeholder')
    expect(followUpWait.getAttribute('data-phase')).toBe('followup')
    expect(followUpWait.textContent).toContain('正在处理子任务结果')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(followUpWait.querySelector('[data-testid="waiting-stop"]')).toBeTruthy()
  })

  it('names the follow-up wait when started arrives before the [subagent-done] card', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '先派一个探索' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    // Production order: follow_up RPC emits started (with the pending prompt)
    // before message_end publishes the user_message card.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n按钮在 Transcript.tsx'] }) })
    const earlyWait = await screen.findByTestId('waiting-placeholder')
    expect(earlyWait.getAttribute('data-phase')).toBe('followup')
    expect(earlyWait.textContent).toContain('正在处理子任务结果')

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'done-1', content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n按钮在 Transcript.tsx' }) })
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('followup')
    expect((await screen.findByTestId('subagent-signal-card')).getAttribute('data-signal-kind')).toBe('done')
  })

  it('does not revive 模型仍在处理 after a lost settle when switching back to a finished answer', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const extraHistory: Record<string, Array<{ id: string; role: 'assistant'; content: string; timestamp: number }>> = {}
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async (sessionId, before, limit) => {
        const page = await base.getSessionHistory(sessionId, before, limit)
        return [...page, ...(extraHistory[sessionId] ?? [])]
      },
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '这是一个 COC 守秘人产品仓库，不是普通聊天应用。' }) })
    extraHistory.layout = [{
      id: 'lost-settle',
      role: 'assistant',
      content: '这是一个 COC 守秘人产品仓库，不是普通聊天应用。',
      timestamp: Date.now(),
    }]
    expect(screen.getByText('这是一个 COC 守秘人产品仓库，不是普通聊天应用。')).toBeTruthy()
    expect(screen.getByLabelText('停止生成')).toBeTruthy()

    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    await screen.findByText(/我会先检查现有结构/)
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await screen.findByText('这是一个 COC 守秘人产品仓库，不是普通聊天应用。')

    await waitFor(() => {
      expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
      expect(screen.queryByLabelText('停止生成')).toBeNull()
    })
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('does not reopen busy on a late [subagent-done] after a settled final answer', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '最终答复已经写完了' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByText('最终答复已经写完了')).toBeTruthy()

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'done-late', content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n找到了设置页' }) })
    expect((await screen.findByTestId('subagent-signal-card')).getAttribute('data-signal-kind')).toBe('done')
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('renders a delayed [subagent-blocked] card without reopening a settled turn', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '最终答复已经落地' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'blocked-late', content: '[subagent-blocked] agentId=a2 title=实现 is held: dependency a1 did not succeed.' }) })
    expect((await screen.findByTestId('subagent-signal-card')).getAttribute('data-signal-kind')).toBe('blocked')
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('does not reopen busy on late heartbeat or stalled projections after settle', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '结论已经落地' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'hb-late', content: '[subagent-heartbeat] outstanding=0 vanished=0 stalled=0' }) })
    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'st-late', content: '[subagent-stalled] agentId=a1 title=探索 idle=120s last=thinking' }) })
    expect(screen.getAllByTestId('subagent-signal-card').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('keeps the final summary when a completion wake starts before its [subagent-done] card', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '先派一个探索' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    // Production extension order: triggerTurn starts the new backend epoch
    // before message_end publishes the completion card. This is the only
    // started event for the Boss follow-up and it carries no pendingFollowUps.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 2, pendingFollowUps: [] }) })
    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'done-1', content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n找到了设置页' }) })
    expect((await screen.findByTestId('subagent-signal-card')).getAttribute('data-signal-kind')).toBe('done')
    const followUpWait = await screen.findByTestId('waiting-placeholder')
    expect(followUpWait.getAttribute('data-phase')).toBe('followup')
    expect(followUpWait.textContent).toContain('正在处理子任务结果')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('running')

    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '最终总结已经完整显示' }) })
    expect(await screen.findByText('最终总结已经完整显示')).toBeTruthy()

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 2 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByText('最终总结已经完整显示')).toBeTruthy()
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('closes a genuinely busy turn when a terminal event belongs to an unopened newer epoch', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    let durableSummaryAvailable = false
    let terminalQueueEmpty = false
    let resolvedTerminalQueueReads = 0
    const stuck = {
      id: 'abort-command',
      sessionId: 'layout',
      text: '/subagent_abort agent-exact',
      attachments: [],
      createdAt: 1,
      state: 'sending' as const,
    }
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      listQueue: async () => {
        if (!terminalQueueEmpty) return [stuck]
        await new Promise(resolve => window.setTimeout(resolve, 40))
        resolvedTerminalQueueReads += 1
        return []
      },
      getSessionHistory: async (sessionId, before, limit) => {
        const page = await base.getSessionHistory(sessionId, before, limit)
        return sessionId === 'layout' && durableSummaryAvailable
          ? [...page, { id: 'durable-summary', role: 'assistant' as const, content: '持久化的最终总结', timestamp: Date.now() }]
          : page
      },
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '批次仍在处理' }) })
    act(() => { listener?.({ type: 'queue_update', sessionId: 'layout', queue: [stuck] }) })
    expect(screen.getByLabelText('停止生成')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('当前会话忙碌，发送将终止当前回复并立即插入（后台子任务继续）…')
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 300)) })

    durableSummaryAvailable = true
    terminalQueueEmpty = true
    // Production exact-abort closeout: the renderer missed epoch 2's started,
    // but receives its terminal after the durable Boss report is already in JSONL.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 2 }) })

    expect(await screen.findByText('持久化的最终总结')).toBeTruthy()
    await waitFor(() => expect(resolvedTerminalQueueReads).toBeGreaterThan(0))
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '下一条消息' } })
    expect((screen.getByLabelText('发送消息') as HTMLButtonElement).disabled).toBe(false)
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('closes scalar busy on the trailing history pull after the first pull replaces the live tail', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    let durableSummaryAvailable = false
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async (sessionId, before, limit) => {
        const page = await base.getSessionHistory(sessionId, before, limit)
        return sessionId === 'layout' && durableSummaryAvailable
          ? [...page, { id: 'durable-race-summary', role: 'assistant' as const, content: '完整持久化结论', timestamp: Date.now() }]
          : page
      },
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 2 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '不完整实时尾部' }) })
    expect(screen.getByLabelText('停止生成')).toBeTruthy()
    durableSummaryAvailable = true
    // An older terminal may trigger reconciliation but must not directly close
    // epoch 2. The first pull replaces the live tail; the bounded trailing pull
    // sees that exact settled snapshot and must clear the split scalar busy flag.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })

    expect(await screen.findByText('完整持久化结论')).toBeTruthy()
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull(), { timeout: 1_000 })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('closes the exact durable abort summary and delayed-empty queue after a stale terminal', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    let durableSummaryAvailable = false
    let terminalQueueEmpty = false
    let resolvedTerminalQueueReads = 0
    const staleSending = {
      id: 'abort-d-hang',
      sessionId: 'layout',
      text: '/subagent_abort agent-41772b9589e92166',
      attachments: [],
      createdAt: 1,
      state: 'sending' as const,
    }
    const initialSummary = '批次 D 仍在等待 C-HANG'
    const finalSummary = '批次D回归汇报：D-OK 已完成，D-HANG 已精确中止。'
    const base = createMockHost()
    const listQueue = vi.fn(async () => {
      if (!terminalQueueEmpty) return [staleSending]
      await new Promise(resolve => window.setTimeout(resolve, 40))
      resolvedTerminalQueueReads += 1
      return []
    })
    const host: PipiHostAPI = {
      ...base,
      listQueue,
      getSessionHistory: async (sessionId, before, limit) => {
        const page = await base.getSessionHistory(sessionId, before, limit)
        return sessionId === 'layout'
          ? [...page, {
              id: 'batch-d-final',
              role: 'assistant' as const,
              content: durableSummaryAvailable ? finalSummary : initialSummary,
              timestamp: 2,
            }]
          : page
      },
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await screen.findByText(initialSummary)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 2, pendingFollowUps: ['Supervisor notification'] }) })
    act(() => { listener?.({ type: 'queue_update', sessionId: 'layout', queue: [staleSending] }) })
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('当前会话忙碌，发送将终止当前回复并立即插入（后台子任务继续）…')

    // The canonical D trace had already rendered the durable final branch by
    // the time the terminal-triggered history pull completed. Secret redaction
    // is a deterministic same-id stream mutation that recreates that exact
    // live/durable fingerprint without inventing another assistant message.
    act(() => {
      listener?.({
        type: 'secret_redact',
        sessionId: 'layout',
        messages: [{ id: 'batch-d-final', role: 'assistant', content: finalSummary }],
      })
    })
    durableSummaryAvailable = true
    terminalQueueEmpty = true
    const queueReadsBeforeTerminal = listQueue.mock.calls.length

    // Epoch 1 is older than the genuinely open epoch 2, so it may reconcile
    // durable history but must not directly close the live turn.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })

    expect(await screen.findByText(finalSummary)).toBeTruthy()
    await waitFor(() => expect(resolvedTerminalQueueReads).toBeGreaterThan(0), { timeout: 1_000 })
    expect(listQueue.mock.calls.length).toBeGreaterThan(queueReadsBeforeTerminal)
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '下一条消息' } })
    expect((screen.getByLabelText('发送消息') as HTMLButtonElement).disabled).toBe(false)
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it('does not let an older terminal close a genuinely newer first-token wait', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    let durableFinalAvailable = false
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async (sessionId, before, limit) => {
        const page = await base.getSessionHistory(sessionId, before, limit)
        return sessionId === 'layout' && durableFinalAvailable
          ? [...page, { id: 'epoch-1-final', role: 'assistant' as const, content: '第一轮已经完成', timestamp: Date.now() }]
          : page
      },
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '第一轮已经完成' }) })
    durableFinalAvailable = true
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 2, pendingFollowUps: ['真正的新请求'] }) })
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 350)) })

    expect(screen.getByTestId('waiting-placeholder')).toBeTruthy()
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('当前会话忙碌，发送将终止当前回复并立即插入（后台子任务继续）…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('running')
  })

  it('reopens a live wait when a queued 继续 user_message arrives after a ghost started', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).not.toBeNull())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '不是坏了，是按设计不继承。' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    // Production: PipiUI queue drain sends a new prompt. Pi's agent_start has
    // empty followUps, so the UI used to ignore it as a ghost and then drop
    // the real 继续 turn — idle composer + leftover 排队条.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()

    act(() => {
      listener?.({ type: 'user_message', sessionId: 'layout', id: 'cont-1', content: '继续' })
      listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'read-1', name: 'read', delta: '{}' })
    })
    const wait = await screen.findByTestId('waiting-placeholder')
    expect(wait.getAttribute('data-phase')).toBe('tool')
    expect(screen.getByText('继续')).toBeTruthy()
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).not.toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('running')
  })

  it('does not freeze a silent next hop when a previous turn settled arrives after tools', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '先派三个探索' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => {
      listener?.({ type: 'user_message', sessionId: 'layout', id: 'done-1', content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n报告已齐' })
      listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 2, pendingFollowUps: ['[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n报告已齐'] })
    })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'status-1', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'status-2', name: 'subagent_status', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'status-1', content: 'ok', isError: false }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'status-2', content: 'ok', isError: false }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'note-1', name: 'ledger_note', delta: '{}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'note-1', content: 'ok', isError: false }) })

    const wait = await screen.findByTestId('waiting-placeholder')
    expect(wait.textContent).toContain('模型正在思考')
    expect(screen.getByRole('button', { name: /个步骤/ }).textContent).toContain('运行中')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)

    // Production: empty-stop reconciliation from the previous turn emits this
    // after the follow-up already started its silent openai-codex conclusion.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 1 }) })
    expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型正在思考')
    expect(screen.getByRole('button', { name: /个步骤/ }).textContent).toContain('运行中')
    expect(screen.getByRole('button', { name: /个步骤/ }).textContent).not.toContain('已完成')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)

    const conclusion = '`ACTIVE_IMPLEMENTATION_TRACK=pi-coc`\n\n我把两条链路都梳理了一遍。'
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: conclusion }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
    expect(screen.getByText(/我把两条链路都梳理了一遍/)).toBeTruthy()

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled', turnEpoch: 2 }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByText(/我把两条链路都梳理了一遍/)).toBeTruthy()
  })

  it('keeps same-tick follow-up tools after a started that carries the drained prompt', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '结论已经写完了' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => {
      listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['继续'] })
      listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'read-1', name: 'read', delta: '{}' })
    })
    const wait = await screen.findByTestId('waiting-placeholder')
    expect(wait.getAttribute('data-phase')).toBe('tool')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('running')
  })

  it('keeps stop and injects send when leftover queued items remain after settle', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const leftover = {
      id: 'leftover-q',
      sessionId: 'welcome',
      text: '?',
      attachments: [],
      createdAt: 1,
      state: 'queued' as const,
    }
    const enqueueMessage = vi.fn(async (sessionId: string, text: string) => ({
      outcome: 'queued' as const,
      message: { ...leftover, id: 'next-q', text },
    }))
    const cutInQueuedMessage = vi.fn(async (_sessionId: string, messageId: string) => ({
      ...leftover,
      id: messageId,
      state: 'sending' as const,
    }))
    const steerQueuedMessage = vi.fn()
    const sendPrompt = vi.fn(async () => undefined)
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      sendPrompt,
      enqueueMessage,
      cutInQueuedMessage,
      steerQueuedMessage,
      listQueue: async () => [leftover],
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'welcome', contentIndex: 0, delta: '上一轮已经说完。' }) })
    act(() => { listener?.({ type: 'queue_update', sessionId: 'welcome', queue: [leftover] }) })
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })

    await waitFor(() => expect(screen.getByLabelText('停止生成')).toBeTruthy())
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('当前会话忙碌，发送将终止当前回复并立即插入（后台子任务继续）…')
    fireEvent.click(screen.getByTestId('message-queue-toggle'))
    expect(screen.getByLabelText('立即发送第 1 条')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '所以呢' } })
    fireEvent.click(screen.getByLabelText('插入当前对话'))
    await waitFor(() => expect(enqueueMessage).toHaveBeenCalledWith('welcome', '所以呢', undefined))
    await waitFor(() => expect(cutInQueuedMessage).toHaveBeenCalledWith('welcome', 'next-q'))
    expect(steerQueuedMessage).not.toHaveBeenCalled()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('does not keep the composer busy on a leftover sending item after stop', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    let terminalQueueEmpty = false
    let resolvedTerminalQueueReads = 0
    const stuck = {
      id: 'stuck-send',
      sessionId: 'layout',
      text: '对啊，参数填错就是大问题啊，为什么参数填错呢？',
      attachments: [],
      createdAt: 1,
      state: 'sending' as const,
    }
    const base = createMockHost()
    const listQueue = vi.fn(async () => {
      if (!terminalQueueEmpty) return [stuck]
      await new Promise(resolve => window.setTimeout(resolve, 40))
      resolvedTerminalQueueReads += 1
      return []
    })
    const host: PipiHostAPI = {
      ...base,
      listQueue,
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '是的，pi-coc 的调用方式和普通工具明显不同。' }) })
    act(() => { listener?.({ type: 'queue_update', sessionId: 'layout', queue: [stuck] }) })
    expect(screen.getByLabelText('停止生成')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('当前会话忙碌，发送将终止当前回复并立即插入（后台子任务继续）…')

    terminalQueueEmpty = true
    const queueReadsBeforeTerminal = listQueue.mock.calls.length
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'stopped' }) })
    await waitFor(() => expect(resolvedTerminalQueueReads).toBeGreaterThan(0))
    expect(listQueue.mock.calls.length).toBeGreaterThan(queueReadsBeforeTerminal)
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).not.toBe('running')
  })

  it.each(['settled', 'stopped'] as const)(
    'dirties the accessibility node on busy-to-idle without replacing the focused IME draft on %s',
    async terminalStatus => {
      let listener: ((event: StreamEvent) => void) | undefined
      let terminalQueueEmpty = false
      let resolvedTerminalQueueReads = 0
      const sending = {
        id: `accessibility-${terminalStatus}`,
        sessionId: 'layout',
        text: '保留输入法草稿',
        attachments: [],
        createdAt: 1,
        state: 'sending' as const,
      }
      const base = createMockHost()
      const host: PipiHostAPI = {
        ...base,
        listQueue: async () => {
          if (!terminalQueueEmpty) return [sending]
          await new Promise(resolve => window.setTimeout(resolve, 40))
          resolvedTerminalQueueReads += 1
          return []
        },
        subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
      }
      const { container } = render(<App host={host} />)
      await screen.findAllByText('Electron 三栏界面')
      fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
      await waitFor(() => expect(listener).toBeDefined())

      const input = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
      input.focus()
      fireEvent.compositionStart(input)
      fireEvent.change(input, { target: { value: '批次 E 输入法草稿' } })
      act(() => {
        listener?.({ type: 'status', sessionId: 'layout', status: 'started', turnEpoch: 1 })
        listener?.({ type: 'queue_update', sessionId: 'layout', queue: [sending] })
      })

      expect(screen.getByLabelText('消息输入框')).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('批次 E 输入法草稿')
      expect(input.getAttribute('placeholder')).toBe('当前会话忙碌，发送将终止当前回复并立即插入（后台子任务继续）…')
      expect(input.classList.contains('queue-busy')).toBe(true)
      expect(input.getAttribute('aria-busy')).toBeNull()

      terminalQueueEmpty = true
      act(() => { listener?.({ type: 'status', sessionId: 'layout', status: terminalStatus, turnEpoch: 1 }) })
      await waitFor(() => expect(resolvedTerminalQueueReads).toBeGreaterThan(0))

      expect(screen.getByLabelText('消息输入框')).toBe(input)
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('批次 E 输入法草稿')
      expect(input.getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
      expect(input.classList.contains('idle')).toBe(true)
      expect(input.classList.contains('queue-busy')).toBe(false)
      expect(input.getAttribute('aria-busy')).toBeNull()
      expect(screen.getByLabelText('发送消息')).toBeTruthy()
      fireEvent.compositionEnd(input)
    },
  )
})
