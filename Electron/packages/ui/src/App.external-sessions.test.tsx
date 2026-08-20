// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalSession, ExternalSessionHistory, PipiHostAPI, Project, Session } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }))
    return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div>
  }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { buffer = { active: { viewportY: 0, baseY: 0 } }; open = vi.fn(); write = vi.fn(); dispose = vi.fn(); loadAddon = vi.fn(); onData() { return { dispose: vi.fn() } } onScroll() { return { dispose: vi.fn() } } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

const project: Project = { id: 'demo', name: 'Demo', path: '/tmp/demo' }

function ext(overrides: Partial<ExternalSession> & Pick<ExternalSession, 'id' | 'source'>): ExternalSession {
  return {
    title: overrides.id,
    cwd: project.path,
    updatedAt: 1,
    historyAvailability: 'text',
    ...overrides,
  }
}

function hostWithExternals(overrides: Partial<PipiHostAPI> = {}): PipiHostAPI {
  const pi: Session = { id: 'pi-mid', projectId: project.id, name: 'Pi 会话', updatedAt: 2_000 }
  const externals: ExternalSession[] = [
    ext({ id: 'ext:claude:new', source: 'claude', title: 'Claude 新', updatedAt: 3_000 }),
    ext({ id: 'ext:codex:old', source: 'codex', title: 'Codex 旧', updatedAt: 1_000 }),
    ext({ id: 'ext:grok:g', source: 'grok', title: 'Grok', updatedAt: 500 }),
    ext({ id: 'ext:cursor:c', source: 'cursor', title: 'Cursor', updatedAt: 400 }),
    ext({ id: 'ext:opencode:o', source: 'opencode', title: 'OpenCode', updatedAt: 300 }),
    ext({ id: 'ext:zcode:z', source: 'zcode', title: 'ZCode', updatedAt: 200 }),
  ]
  const history: ExternalSessionHistory = {
    id: 'ext:claude:new',
    source: 'claude',
    availability: 'text',
    entries: [
      { id: 'u1', role: 'user', content: '外部提问', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: '外部回答', timestamp: 2 },
    ],
  }
  const base = createMockHost()
  return {
    ...base,
    listProjects: async () => [project],
    listSessions: async () => [pi],
    listExternalSessions: async () => externals,
    getExternalSessionHistory: vi.fn(async () => history),
    getSessionHistory: vi.fn(async () => []),
    getSessionLease: vi.fn(async sessionId => ({ sessionId, writable: true })),
    sendPrompt: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    renameSession: vi.fn(async (sessionId, name) => ({ id: sessionId, projectId: project.id, name, updatedAt: Date.now() })),
    resumeSession: vi.fn(async sessionId => ({ id: sessionId, projectId: project.id, name: sessionId, updatedAt: Date.now() })),
    setModel: vi.fn(base.setModel),
    forceTakeoverSessionLease: vi.fn(async sessionId => ({ sessionId, writable: true })),
    ...overrides,
  }
}

describe('external session aggregation', () => {
  it('mixes Pi and external rows by updatedAt and shows dedicated source icons', async () => {
    render(<App host={hostWithExternals()} />)
    const group = await screen.findByRole('group', { name: 'Demo 的会话' })
    await waitFor(() => expect(within(group).getAllByTestId('session-row').length).toBeGreaterThan(2))
    expect(within(group).getAllByTestId('session-row').map(row => row.getAttribute('data-session-id'))).toEqual([
      'ext:claude:new',
      'pi-mid',
      'ext:codex:old',
      'ext:grok:g',
      'ext:cursor:c',
      'ext:opencode:o',
      'ext:zcode:z',
    ])
    expect(within(group).getByTestId('session-source-claude')).toBeTruthy()
    expect(within(group).getByTestId('session-source-codex')).toBeTruthy()
    expect(within(group).getByTestId('session-source-grok')).toBeTruthy()
    const cursorMark = within(group).getByTestId('session-source-cursor')
    expect(cursorMark.querySelector('[data-testid="provider-logo-cursor"] svg path')).toBeTruthy()
    expect(cursorMark.textContent).not.toMatch(/c/i)
    expect(within(group).getByTestId('session-source-opencode')).toBeTruthy()
    expect(within(group).getByTestId('session-source-zcode')).toBeTruthy()
    expect(within(group).getByTestId('session-source-pi')).toBeTruthy()
    expect(within(group).getByLabelText('Anthropic/Claude · Claude 新')).toBeTruthy()
    for (const row of within(group).getAllByTestId('session-row')) {
      const id = row.getAttribute('data-session-id') ?? ''
      if (id.startsWith('ext:')) {
        expect(within(row).getByTestId('session-external-badge').textContent).toBe('外部')
      }
    }
    const piRow = within(group).getAllByTestId('session-row').find(row => row.getAttribute('data-session-id') === 'pi-mid')!
    expect(within(piRow).queryByTestId('session-external-badge')).toBeNull()
  })

  it('loads read-only external history without touching Pi session APIs', async () => {
    const host = hostWithExternals()
    render(<App host={host} />)
    const row = await waitFor(() => {
      const found = document.querySelector('[data-session-id="ext:claude:new"]')
      if (!found) throw new Error('external row missing')
      return found as HTMLElement
    })
    fireEvent.click(row)
    await screen.findByText('外部提问')
    expect(screen.getByText('外部回答')).toBeTruthy()
    expect(screen.getByTestId('external-session-readonly').textContent).toContain('只读')
    expect(screen.getByTestId('composer-read-only').textContent).toContain('只读会话')
    expect(screen.queryByTestId('composer-lease-takeover')).toBeNull()
    expect(screen.queryByTestId('model-chip')).toBeNull()
    expect((screen.getByLabelText('消息输入框') as HTMLTextAreaElement).disabled).toBe(true)
    expect(host.getExternalSessionHistory).toBeTruthy()
    expect(host.getSessionHistory).not.toHaveBeenCalledWith('ext:claude:new')
    expect(host.getSessionLease).not.toHaveBeenCalledWith('ext:claude:new')
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(host.sendPrompt).not.toHaveBeenCalled()
    expect(within(row).queryByRole('button', { name: '修改标题' })).toBeNull()
    expect(within(row).queryByRole('button', { name: '归档会话' })).toBeNull()
  })

  it('keeps the Pi list when listing external sessions fails', async () => {
    const host = hostWithExternals({
      listExternalSessions: async () => { throw new Error('cursor scanner exploded') },
    })
    render(<App host={host} />)
    await screen.findByText('Pi 会话')
    expect(screen.queryByText('Claude 新')).toBeNull()
    expect(screen.queryByText(/加载会话列表失败/)).toBeNull()
    expect(document.querySelector('[data-session-id="pi-mid"]')).toBeTruthy()
  })

  it('shows Pi projects while external listing is still pending', async () => {
    const host = hostWithExternals({
      listExternalSessions: () => new Promise(() => {}),
    })
    render(<App host={host} />)
    await screen.findByText('Pi 会话')
    expect(screen.getByText('Demo')).toBeTruthy()
    expect(screen.queryByTestId('sidebar-empty')).toBeNull()
    expect(screen.queryByText('Claude 新')).toBeNull()
  })

  it('does not call listExternalSessions when the scan toggle is off', async () => {
    const listExternalSessions = vi.fn(async () => [ext({ id: 'ext:claude:new', source: 'claude', title: 'Claude 新' })])
    const host = hostWithExternals({
      getScanExternalSessions: async () => false,
      listExternalSessions,
    })
    render(<App host={host} />)
    await screen.findByText('Pi 会话')
    expect(screen.queryByText('Claude 新')).toBeNull()
    expect(listExternalSessions).not.toHaveBeenCalled()
  })

  it('lists external sessions when the scan toggle stays on', async () => {
    const listExternalSessions = vi.fn(async () => [ext({ id: 'ext:claude:new', source: 'claude', title: 'Claude 新' })])
    const host = hostWithExternals({
      getScanExternalSessions: async () => true,
      listExternalSessions,
    })
    render(<App host={host} />)
    await screen.findByText('Claude 新')
    expect(listExternalSessions).toHaveBeenCalled()
  })

  it('clears existing external rows and drops an ext: selection when the scan toggle turns off', async () => {
    let scanEnabled = true
    const listExternalSessions = vi.fn(async () => [ext({ id: 'ext:claude:new', source: 'claude', title: 'Claude 新' })])
    const host = hostWithExternals({
      getScanExternalSessions: async () => scanEnabled,
      setScanExternalSessions: async enabled => { scanEnabled = enabled; return scanEnabled },
      listExternalSessions,
    })
    render(<App host={host} />)
    const row = await waitFor(() => {
      const found = document.querySelector('[data-session-id="ext:claude:new"]')
      if (!found) throw new Error('external row missing')
      return found as HTMLElement
    })
    fireEvent.click(row)
    await screen.findByText('外部提问')
    const callsBeforeOff = listExternalSessions.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    fireEvent.click(screen.getByTestId('model-tab-general'))
    fireEvent.click(screen.getByTestId('scan-external-sessions-switch'))
    await waitFor(() => {
      expect(screen.queryByText('Claude 新')).toBeNull()
      expect(document.querySelector('[data-session-id="ext:claude:new"]')).toBeNull()
    })
    expect(document.querySelector('[data-session-id="pi-mid"]')).toBeTruthy()
    expect(listExternalSessions.mock.calls.length).toBe(callsBeforeOff)
  })
})
