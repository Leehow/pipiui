// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, HistoryEntry, PipiHostAPI, QueuedMessage, StreamEvent } from '@pipi/host-api'

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

function controlledHost(overrides: Partial<PipiHostAPI> = {}) {
  const listeners = new Map<string, (event: StreamEvent) => void>()
  const base = createMockHost()
  const host: PipiHostAPI = {
    ...base,
    subscribeStream: (sessionId, listener) => { listeners.set(sessionId, listener); return () => { if (listeners.get(sessionId) === listener) listeners.delete(sessionId) } },
    ...overrides,
  }
  return { host, listeners }
}

async function ready(listeners: Map<string, (event: StreamEvent) => void>) {
  await screen.findAllByText('Electron 三栏界面')
  await waitFor(() => expect(listeners.get('welcome')).toBeDefined())
}

describe('selected-session working stop control', () => {
  it('shows for a restored observed-running session and routes one pending stop to the exact session', async () => {
    let resolveStop: (() => void) | undefined
    const stop = vi.fn(() => new Promise<void>(resolve => { resolveStop = resolve }))
    const { host, listeners } = controlledHost({ stop })
    const { container } = render(<App host={host} />)
    await ready(listeners)

    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listeners.get('layout')).toBeDefined())
    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    await waitFor(() => expect(listeners.get('welcome')).toBeDefined())

    const stopButton = await waitFor(() => {
      const button = container.querySelector('.send.stop') as HTMLButtonElement | null
      expect(button).toBeTruthy()
      return button!
    })
    fireEvent.click(stopButton)
    fireEvent.click(screen.getByLabelText('正在停止'))
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(stop).toHaveBeenCalledWith('welcome')
    expect((screen.getByLabelText('正在停止') as HTMLButtonElement).disabled).toBe(true)

    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'stopped' }) })
    resolveStop?.()
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
  })

  it('recovers from stop rejection with a dismissible error and re-enabled stop', async () => {
    const stop = vi.fn(async () => { throw new Error('host refused') })
    const { host, listeners } = controlledHost({ stop })
    const { container } = render(<App host={host} />)
    await ready(listeners)
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })

    const composerStop = () => container.querySelector('.send.stop') as HTMLButtonElement
    fireEvent.click(composerStop())
    expect(await screen.findByText('停止失败：host refused')).toBeTruthy()
    expect(composerStop().disabled).toBe(false)
    fireEvent.click(screen.getByTestId('composer-error-close'))
    expect(screen.queryByText('停止失败：host refused')).toBeNull()
  })

  it('ignores a late stop rejection after authoritative stopped', async () => {
    let rejectStop: ((error: Error) => void) | undefined
    const stop = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectStop = reject }))
    const { host, listeners } = controlledHost({ stop })
    render(<App host={host} />)
    await ready(listeners)
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })

    fireEvent.click((await screen.findAllByLabelText('停止生成'))[0])
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'stopped' }) })
    rejectStop?.(new Error('too late'))

    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.queryByText('停止失败：too late')).toBeNull()
  })

  it('shows stop and queue-submit together for an active sending queue item', async () => {
    const sending: QueuedMessage = { id: 'sending', sessionId: 'welcome', text: '正在发送', attachments: [], state: 'sending', createdAt: 1 }
    const { host, listeners } = controlledHost({ listQueue: async sessionId => sessionId === 'welcome' ? [sending] : [] })
    render(<App host={host} />)
    await ready(listeners)
    await screen.findAllByLabelText('停止生成')

    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '下一条' } })
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('加入消息队列')).toBeTruthy()
  })

  it('keeps idle and subagent-only sessions on the ordinary send control', async () => {
    const agent: AgentSummary = { agentId: 'worker', runId: 'run', name: 'worker', task: 'background', state: 'running', sessionId: 'welcome' }
    const { host, listeners } = controlledHost({ listAgents: async () => [agent] })
    render(<App host={host} />)
    await ready(listeners)
    await screen.findByLabelText('发送消息')

    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
  })

  it('uses a streaming assistant message as a main-turn stop signal', async () => {
    const { host, listeners } = controlledHost()
    render(<App host={host} />)
    await ready(listeners)

    act(() => { listeners.get('welcome')?.({ type: 'text', sessionId: 'welcome', contentIndex: 0, delta: 'host output' }) })
    expect(await screen.findByLabelText('停止生成')).toBeTruthy()
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
  })

  it('does not stay busy after a late streaming status on a settled turn', async () => {
    const { host, listeners } = controlledHost()
    render(<App host={host} />)
    await ready(listeners)

    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })
    act(() => { listeners.get('welcome')?.({ type: 'text', sessionId: 'welcome', contentIndex: 0, delta: '打包结果回来了' }) })
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(screen.queryByTestId('stats-streaming')).toBeNull()

    // Pi's queue_update is mapped to status:streaming. After settle that must
    // not reopen the composer as 生成中 / 当前会话忙碌 with nothing to show.
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'streaming' }) })
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(screen.queryByTestId('stats-streaming')).toBeNull()
  })

  it('does not keep the stop button when a late delta arrives after settle', async () => {
    const { host, listeners } = controlledHost()
    render(<App host={host} />)
    await ready(listeners)

    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['host'] }) })
    act(() => { listeners.get('welcome')?.({ type: 'text', sessionId: 'welcome', contentIndex: 0, delta: '结论已经写完了' }) })
    act(() => { listeners.get('welcome')?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    // A leftover text/tool event after agent_settled must not reopen a streaming
    // assistant bubble. That leaves the composer idle except for a stranded stop.
    act(() => { listeners.get('welcome')?.({ type: 'text', sessionId: 'welcome', contentIndex: 0, delta: '迟到的尾巴' }) })
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
    expect(screen.queryByTestId('stats-streaming')).toBeNull()
  })

  it('reconciles a locally sent Computer Task when its terminal agent projection arrives without main-stream settle', async () => {
    const base = createMockHost()
    const streamListeners = new Map<string, (event: StreamEvent) => void>()
    const agentListeners = new Set<(event: AgentEvent) => void>()
    let terminalHistory: HistoryEntry[] | undefined
    const host: PipiHostAPI = {
      ...base,
      sendPrompt: vi.fn(async () => undefined),
      listQueue: async () => [],
      getSessionHistory: async (sessionId, before, limit) => terminalHistory && sessionId === 'layout'
        ? terminalHistory
        : base.getSessionHistory(sessionId, before, limit),
      listAgents: async () => [],
      subscribeStream: (sessionId, listener) => {
        streamListeners.set(sessionId, listener)
        return () => { if (streamListeners.get(sessionId) === listener) streamListeners.delete(sessionId) }
      },
      subscribeAgents: listener => { agentListeners.add(listener); return () => { agentListeners.delete(listener) } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const layoutRow = await waitFor(() => {
      const row = container.querySelector('[data-session-id="layout"]')
      expect(row).toBeTruthy()
      return row!
    })
    fireEvent.click(layoutRow)
    await waitFor(() => expect(streamListeners.get('layout')).toBeDefined())

    const input = screen.getByLabelText('消息输入框')
    fireEvent.change(input, { target: { value: 'keeper-fullrun-terminal' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(host.sendPrompt).toHaveBeenCalledWith('layout', 'keeper-fullrun-terminal'))

    const running: AgentSummary = {
      agentId: 'computer-root',
      runId: 'computer-run',
      sessionId: 'layout',
      name: 'computer-use-leader',
      task: 'Computer Task',
      state: 'running',
      createdAt: 10,
    }
    act(() => {
      for (const listener of agentListeners) listener({ type: 'agent', agent: running })
      streamListeners.get('layout')?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: 'keeper-fullrun 已通过' })
    })
    await screen.findByText('keeper-fullrun 已通过')
    await waitFor(() => expect(screen.getByLabelText('1 个运行中的 subagent')).toBeTruthy())

    terminalHistory = [
      { id: 'terminal-user', role: 'user', content: 'keeper-fullrun-terminal', timestamp: 20 },
      { id: 'terminal-assistant', role: 'assistant', content: 'keeper-fullrun 已通过', timestamp: 30 },
    ]
    act(() => {
      streamListeners.get('layout')?.({ type: 'queue_update', sessionId: 'layout', queue: [] })
      for (const listener of agentListeners) listener({ type: 'agent', agent: { ...running, state: 'ok', endedAt: 30 } })
    })

    await waitFor(() => expect(screen.queryByLabelText('1 个运行中的 subagent')).toBeNull())
    await waitFor(() => expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…'))
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
  })
})
