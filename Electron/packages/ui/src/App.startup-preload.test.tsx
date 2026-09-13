// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSummary, HistoryEntry, PipiHostAPI, SessionPreloadSnapshot, StreamEvent } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn(), getState: vi.fn() }))
    return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div>
  }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))

import { App, createMockHost, LAST_SESSION_STORAGE_KEY } from './App'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

/** Expand every collapsed activity card so folded thinking/tool bodies become visible. */
function expandAllCards() {
  for (let pass = 0; pass < 4; pass += 1) {
    const collapsed = screen.queryAllByRole('button').filter(button => button.getAttribute('aria-expanded') === 'false' && button.closest('[data-activity-card]'))
    if (!collapsed.length) break
    collapsed.forEach(button => fireEvent.click(button))
  }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('startup-first lazy session warming', () => {
  it('restores only the remembered transcript while session pages stay metadata-only', async () => {
    const project = { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' }
    const remembered = { id: 'remembered', projectId: project.id, name: 'Remembered', updatedAt: 100 }
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      id: `page-${index}`,
      projectId: project.id,
      name: `Page ${index}`,
      updatedAt: 90 - index,
    }))
    const secondPage = Array.from({ length: 10 }, (_, index) => ({
      id: `page-${index + 10}`,
      projectId: project.id,
      name: `Page ${index + 10}`,
      updatedAt: 80 - index,
    }))
    const rememberedPreload = deferred<SessionPreloadSnapshot>()
    const listSessionPage = vi.fn(async (_projectId: string, cursor?: string) => cursor
      ? { sessions: secondPage, hasMore: false }
      : { sessions: firstPage, nextCursor: '10', hasMore: true })
    const preloadSession = vi.fn(async (sessionId: string): Promise<SessionPreloadSnapshot> => {
      if (sessionId === remembered.id) return rememberedPreload.promise
      return {
        history: [{ id: `${sessionId}-body`, role: 'user', content: `Body ${sessionId}`, timestamp: 1 }],
        agents: [],
        agentLogs: [],
      }
    })
    const base = createMockHost()
    const externalSessions = Array.from({ length: 15 }, (_, index) => ({
      id: `ext:codex:external-${index}`,
      source: 'codex' as const,
      title: `External ${index}`,
      cwd: project.path,
      updatedAt: 200 - index,
      historyAvailability: 'text' as const,
    }))
    const host: PipiHostAPI = {
      ...base,
      listProjects: vi.fn(async () => [project]),
      getProjectPaths: vi.fn(async () => [project.path]),
      listSessions: vi.fn(async () => { throw new Error('startup must not use the global list') }),
      listSessionPage,
      getSession: vi.fn(async () => remembered),
      preloadSession,
      getSessionHistory: vi.fn(() => new Promise<never>(() => undefined)),
      listExternalSessions: vi.fn(async () => externalSessions),
    }
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: project.id, sessionId: remembered.id }))

    render(<App host={host} />)
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Remembered')).toBeNull()
    expect(listSessionPage).not.toHaveBeenCalled()

    await act(async () => rememberedPreload.resolve({
      history: [{ id: 'remembered-body', role: 'user', content: 'Remembered body', timestamp: 1 }],
      agents: [],
      agentLogs: [],
    }))
    expect((await screen.findAllByText('Remembered')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByTestId('message-scroll').textContent).toContain('Remembered body'))
    await waitFor(() => expect(listSessionPage).toHaveBeenCalledTimes(1))
    const group = await screen.findByRole('group', { name: 'Alpha 的会话' })
    await waitFor(() => expect(within(group).getAllByTestId('session-row')).toHaveLength(10))
    expect(preloadSession.mock.calls.map(([id]) => id)).toEqual([remembered.id])
    expect(within(group).getByTestId('show-more-sessions')).toBeTruthy()

    fireEvent.click(within(group).getByTestId('show-more-sessions'))
    await waitFor(() => expect(listSessionPage).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(group).getAllByTestId('session-row')).toHaveLength(20))
    expect(preloadSession.mock.calls.map(([id]) => id)).toEqual([remembered.id])
  })

  it('restores the exact remembered external session before lazy project pages', async () => {
    const project = { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' }
    const rememberedId = 'ext:codex:last-external'
    const external = { id: rememberedId, source: 'codex' as const, title: 'Last external', cwd: project.path, updatedAt: 100, historyAvailability: 'text' as const }
    const externalHistory = deferred<{ id: string; source: 'codex'; availability: 'text'; entries: Array<{ id: string; role: 'user'; content: string; timestamp: number }> }>()
    const listSessionPage = vi.fn(async () => ({ sessions: [], hasMore: false }))
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      listProjects: vi.fn(async () => [project]),
      getProjectPaths: vi.fn(async () => [project.path]),
      listSessionPage,
      getSession: vi.fn(async () => { throw new Error('external session must not use Pi lookup') }),
      preloadSession: vi.fn(async () => ({ history: [], agents: [], agentLogs: [] })),
      listExternalSessions: vi.fn(async () => [external]),
      getExternalSessionHistory: vi.fn(async () => externalHistory.promise),
    }
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: project.id, sessionId: rememberedId }))

    render(<App host={host} />)
    expect(await screen.findByText('Alpha')).toBeTruthy()
    expect(listSessionPage).not.toHaveBeenCalled()
    await act(async () => externalHistory.resolve({
      id: rememberedId,
      source: 'codex',
      availability: 'text',
      entries: [{ id: 'external-body', role: 'user', content: 'Exact external body', timestamp: 1 }],
    }))
    expect((await screen.findAllByText('Last external')).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByTestId('message-scroll').textContent).toContain('Exact external body'))
    await waitFor(() => expect(listSessionPage).toHaveBeenCalled())
    expect(host.getSession).not.toHaveBeenCalled()
  })

  it('falls back to live host logs when preloaded agent logs are empty', async () => {
    const project = { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' }
    const remembered = { id: 'remembered', projectId: project.id, name: 'Remembered', updatedAt: 100 }
    const base = createMockHost()
    const getAgentLogs = vi.fn(async () => [
      { itemType: 'thinking' as const, text: 'grandchild thinking' },
      { itemType: 'tool' as const, name: 'read', text: 'App.tsx' },
      { itemType: 'toolResult' as const, text: 'found the preload wrapper' },
      { itemType: 'text' as const, text: 'grandchild resolved the detail' },
    ])
    const host: PipiHostAPI = {
      ...base,
      listProjects: vi.fn(async () => [project]),
      getProjectPaths: vi.fn(async () => [project.path]),
      listSessionPage: vi.fn(async () => ({ sessions: [], hasMore: false })),
      getSession: vi.fn(async () => remembered),
      preloadSession: vi.fn(async (): Promise<SessionPreloadSnapshot> => ({
        history: [],
        agents: [
          { agentId: 'top', runId: 'run-top', sessionId: 'remembered', name: 'architect', title: 'Top', task: '顶层任务', state: 'ok' as const, createdAt: 1, finalResult: 'top done' },
          { agentId: 'gc', runId: 'run-gc', sessionId: 'remembered', name: 'explore', title: 'Grandchild', task: 'nested detail', state: 'ok' as const, parentId: 'top', createdAt: 2, finalResult: 'grandchild single completed' },
        ],
        agentLogs: [
          // Preload registered the grandchild before any of its logs had landed.
          { agentId: 'gc', sessionId: 'remembered', runId: 'run-gc', entries: [] },
          // A previous run of the same slug and the parent both hold real cached
          // entries: the empty exact-run cache must NOT leak either into the
          // grandchild's transcript.
          { agentId: 'gc', sessionId: 'remembered', runId: 'run-old', entries: [{ itemType: 'text', text: 'OLD-RUN-LOG' }] },
          { agentId: 'top', sessionId: 'remembered', runId: 'run-top', entries: [{ itemType: 'text', text: 'PARENT-LOG' }] },
        ],
      })),
      getSessionHistory: vi.fn(() => new Promise<never>(() => undefined)),
      getAgentLogs,
      listExternalSessions: vi.fn(async () => []),
    }
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: project.id, sessionId: remembered.id }))

    render(<App host={host} />)
    const row = await screen.findByTestId('agent-row-gc', {}, { timeout: 10_000 })
    fireEvent.click(row.querySelector('.agent-select')!)
    // The wrapper must consult the live host with the exact episode triple —
    // never the cross-run 'agent' scope.
    await waitFor(() => expect(getAgentLogs).toHaveBeenCalledWith('gc', 'remembered', 'run-gc'), { timeout: 10_000 })
    expect(getAgentLogs).not.toHaveBeenCalledWith('gc', 'remembered', 'run-gc', 'agent')
    // The transcript — not just the completion summary — renders the late logs.
    const cards = await screen.findAllByTestId('assistant-transcript-content', {}, { timeout: 10_000 })
    expect(cards.length).toBeGreaterThan(0)
    await waitFor(() => expandAllCards(), { timeout: 10_000 })
    expect(await screen.findByText(/grandchild thinking/, undefined, { timeout: 10_000 })).toBeTruthy()
    expect(screen.getByText(/grandchild resolved the detail/)).toBeTruthy()
    // Exact-run isolation: neither the previous run nor the parent leaks in.
    expect(screen.queryByText(/OLD-RUN-LOG/)).toBeNull()
    expect(screen.queryByText(/PARENT-LOG/)).toBeNull()
  }, 20_000)

  it('keeps the non-empty preload log cache on the fast path (no host round-trip)', async () => {
    const project = { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' }
    const remembered = { id: 'remembered', projectId: project.id, name: 'Remembered', updatedAt: 100 }
    const base = createMockHost()
    const getAgentLogs = vi.fn(async () => [{ itemType: 'text' as const, text: 'UNEXPECTED-HOST-READ' }])
    const host: PipiHostAPI = {
      ...base,
      listProjects: vi.fn(async () => [project]),
      getProjectPaths: vi.fn(async () => [project.path]),
      listSessionPage: vi.fn(async () => ({ sessions: [], hasMore: false })),
      getSession: vi.fn(async () => remembered),
      preloadSession: vi.fn(async (): Promise<SessionPreloadSnapshot> => ({
        history: [],
        agents: [
          { agentId: 'warm', runId: 'run-warm', sessionId: 'remembered', name: 'explore', title: 'Warm', task: 'warm cache', state: 'ok' as const, createdAt: 1, finalResult: 'warm done' },
        ],
        agentLogs: [
          { agentId: 'warm', sessionId: 'remembered', runId: 'run-warm', entries: [{ itemType: 'thinking', text: 'BUFFERED-ENTRY' }, { itemType: 'text', text: 'BUFFERED-RESULT' }] },
        ],
      })),
      getSessionHistory: vi.fn(() => new Promise<never>(() => undefined)),
      getAgentLogs,
      listExternalSessions: vi.fn(async () => []),
    }
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: project.id, sessionId: remembered.id }))

    render(<App host={host} />)
    const row = await screen.findByTestId('agent-row-warm', {}, { timeout: 10_000 })
    fireEvent.click(row.querySelector('.agent-select')!)
    // The buffered snapshot renders without ever asking the live host.
    const cards = await screen.findAllByTestId('assistant-transcript-content', {}, { timeout: 10_000 })
    expect(cards.length).toBeGreaterThan(0)
    await waitFor(() => expandAllCards(), { timeout: 10_000 })
    expect(screen.getByText(/BUFFERED-ENTRY/)).toBeTruthy()
    expect(getAgentLogs).not.toHaveBeenCalled()
    expect(screen.queryByText(/UNEXPECTED-HOST-READ/)).toBeNull()
  }, 20_000)

  it('hydrates persisted history and clears stale running workers after a blank running restore', async () => {
    const project = { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' }
    const remembered = { id: 'vision-search', projectId: project.id, name: '识图与搜索扩展', updatedAt: 100 }
    const neighbor = { id: 'neighbor', projectId: project.id, name: '邻会话', updatedAt: 90 }
    const history = deferred<HistoryEntry[]>()
    const durableHistory: HistoryEntry[] = [
      { id: 'u1', role: 'user', content: '请调研识图与搜索扩展', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '已派发两个 explore。', timestamp: 2 },
    ]
    const staleRunning: AgentSummary[] = [
      { agentId: 'vision-websearch-recon', runId: 'run-vision', sessionId: remembered.id, name: 'explore', title: '摸清识图+搜索设置现状', task: '摸清识图+搜索设置现状', state: 'running', createdAt: 1 },
      { agentId: 'extension-pattern-recon', runId: 'run-ext', sessionId: remembered.id, name: 'explore', title: '梳理内置扩展标准结构', task: '梳理内置扩展标准结构', state: 'running', createdAt: 2 },
    ]
    const terminalAgents: AgentSummary[] = staleRunning.map(agent => ({ ...agent, state: 'ok', updatedAt: 50, endedAt: 50, finalResult: 'done' }))
    let stream: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const preloadSession = vi.fn(async (_sessionId: string): Promise<SessionPreloadSnapshot> => ({
      history: [],
      agents: staleRunning,
      agentLogs: [],
    }))
    const host: PipiHostAPI = {
      ...base,
      listProjects: vi.fn(async () => [project]),
      getProjectPaths: vi.fn(async () => [project.path]),
      listSessionPage: vi.fn(async () => ({ sessions: [remembered, neighbor], hasMore: false })),
      getSession: vi.fn(async () => remembered),
      preloadSession,
      getSessionHistory: vi.fn(async sessionId => sessionId === remembered.id ? history.promise : []),
      listAgents: vi.fn(async sessionId => terminalAgents.filter(agent => !sessionId || agent.sessionId === sessionId)),
      subscribeStream: (sessionId, callback) => {
        if (sessionId === remembered.id) stream = callback
        return () => { if (stream === callback) stream = undefined }
      },
      subscribeAgents: () => () => undefined,
      listExternalSessions: vi.fn(async () => []),
    }
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: project.id, sessionId: remembered.id }))

    const { container } = render(<App host={host} />)
    expect((await screen.findAllByText('识图与搜索扩展')).length).toBeGreaterThan(0)
    expect(screen.queryByText('请调研识图与搜索扩展')).toBeNull()

    await waitFor(() => expect(stream).toBeDefined())
    act(() => {
      stream?.({ type: 'status', sessionId: remembered.id, status: 'started' })
      stream?.({ type: 'thinking', sessionId: remembered.id, contentIndex: 0, delta: 'ghost' })
    })

    await act(async () => history.resolve(durableHistory))
    expect(await screen.findByText('请调研识图与搜索扩展')).toBeTruthy()
    expect(screen.getByText('已派发两个 explore。')).toBeTruthy()
    act(() => stream?.({ type: 'status', sessionId: remembered.id, status: 'settled' }))
    await waitFor(() => expect(screen.queryByText(/个子任务执行中/)).toBeNull())
    await waitFor(() => expect(container.querySelector('[data-session-id="vision-search"]')?.getAttribute('data-status')).not.toBe('subagents-running'))
    expect(preloadSession.mock.calls.map(([id]) => id)).toEqual([remembered.id])
  })

  it('hydrates earlier turns a live pane is missing even when the read raced a delta', async () => {
    const project = { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' }
    const remembered = { id: 'raced', projectId: project.id, name: '被抢跑的会话', updatedAt: 100 }
    const history = deferred<HistoryEntry[]>()
    const durableHistory: HistoryEntry[] = [
      { id: 'u1', role: 'user', content: '第一个问题', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '第一个回答', timestamp: 2 },
      { id: 'u2', role: 'user', content: '第二个问题', timestamp: 3 },
    ]
    let stream: ((event: StreamEvent) => void) | undefined
    let reads = 0
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      listProjects: vi.fn(async () => [project]),
      getProjectPaths: vi.fn(async () => [project.path]),
      listSessionPage: vi.fn(async () => ({ sessions: [remembered], hasMore: false })),
      getSession: vi.fn(async () => remembered),
      preloadSession: vi.fn(async (): Promise<SessionPreloadSnapshot> => ({ history: [], agents: [], agentLogs: [] })),
      getSessionHistory: vi.fn(async sessionId => {
        if (sessionId !== remembered.id) return []
        reads += 1
        const page = await history.promise
        // A content delta lands while the read is still in flight, exactly as it
        // does on a streaming session: the response arrives against a bumped
        // live revision and is therefore stale on delivery.
        stream?.({ type: 'thinking', sessionId, contentIndex: 0, delta: '·' })
        return page
      }),
      listAgents: vi.fn(async () => []),
      subscribeStream: (sessionId, callback) => {
        if (sessionId === remembered.id) stream = callback
        return () => { if (stream === callback) stream = undefined }
      },
      subscribeAgents: () => () => undefined,
      listExternalSessions: vi.fn(async () => []),
    }
    localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: project.id, sessionId: remembered.id }))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<App host={host} />)
    await waitFor(() => expect(stream).toBeDefined())
    // The live pane holds the newest turn only, and a delta bumps the live
    // revision while the read is still in flight — so the response comes back
    // stale with the turn still open, which is where earlier turns used to be
    // dropped on the floor with no retry until the turn ended.
    act(() => {
      stream?.({ type: 'status', sessionId: remembered.id, status: 'started' })
      stream?.({ type: 'user_message', sessionId: remembered.id, content: '第二个问题' })
      stream?.({ type: 'thinking', sessionId: remembered.id, contentIndex: 0, delta: '思考中' })
    })
    expect(await screen.findByText('第二个问题')).toBeTruthy()
    expect(screen.queryByText('第一个问题')).toBeNull()

    await act(async () => history.resolve(durableHistory))
    expect(await screen.findByText('第一个问题')).toBeTruthy()
    expect(screen.getByText('第一个回答')).toBeTruthy()
    expect(screen.getByText('第二个问题')).toBeTruthy()
    // The read did arrive stale (a delta raced it). It must have been applied on
    // arrival — not dropped on the floor and recovered by a later re-read.
    expect(warn.mock.calls.map(args => String(args[0])).filter(line => line.includes('history_stale_discard'))).toEqual([])
    expect(reads).toBe(1)
  })
})
