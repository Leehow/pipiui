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

  it('opens the follow-up wait from a late [subagent-done] card after a bare started is ignored', async () => {
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

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'done-1', content: '[subagent-done] agentId=a1 name=explore ok=true\nTitle: 探索\nResult:\n找到了设置页' }) })
    expect(screen.getByTestId('waiting-placeholder').getAttribute('data-phase')).toBe('followup')
    expect(screen.getByTestId('waiting-placeholder').textContent).toContain('正在处理子任务结果')
  })

  it('reopens a live wait when a queued 继续 user_message arrives after a ghost started', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
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
})
