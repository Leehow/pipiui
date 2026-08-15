// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, Model, ModelState, PipiHostAPI, Project, PromptAttachment, QueuedMessage, Session, SidebarSessionPreferences, StreamEvent } from '@pipi/host-api'
import { visionHostMethods } from './useVisionRouting'

const xtermHarness = vi.hoisted(() => ({ instances: [] as any[] }))

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
  document.title = ''
  xtermHarness.instances.length = 0
})

const virtuosoHarness = { atBottom: undefined as undefined | ((value: boolean) => void), scrollToIndex: vi.fn() }
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent, atBottomStateChange }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element; atBottomStateChange?: (value: boolean) => void }, ref) => { virtuosoHarness.atBottom = atBottomStateChange; React.useImperativeHandle(ref, () => ({ scrollToIndex: virtuosoHarness.scrollToIndex })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})

vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    options: any
    buffer = { active: { viewportY: 0, baseY: 0 } }
    open = vi.fn()
    write = vi.fn()
    clear = vi.fn()
    focus = vi.fn()
    scrollToBottom = vi.fn()
    dispose = vi.fn()
    loadAddon = vi.fn()
    private dataListener?: (data: string) => void
    private scrollListener?: () => void

    constructor(options: any) {
      this.options = options
      xtermHarness.instances.push(this)
    }

    onData(listener: (data: string) => void) {
      this.dataListener = listener
      return { dispose: vi.fn() }
    }

    onScroll(listener: () => void) {
      this.scrollListener = listener
      return { dispose: vi.fn() }
    }

    emitData(data: string) { this.dataListener?.(data) }
    emitScroll() { this.scrollListener?.() }
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost, mergeAgentSnapshot, mergeAgentSummary, sidebarPreferencesKey, sidebarModelForSession, sidebarStatusForSession, normalizeArchiveTimestamps, expiredArchivedSessionIds, ARCHIVE_RETENTION_MS, DEMO_MODEL_STORAGE_KEY, DEMO_SESSION_MODELS_STORAGE_KEY } from './App'

describe('PipiUI Electron main layout', () => {
  it('keeps archive timestamps stable, grants legacy archives a fresh window, and expires at 24 hours', () => {
    const now = 2_000_000_000_000
    const existing = now - 10_000
    const normalized = normalizeArchiveTimestamps(['existing', 'legacy'], { existing, stale: 1 }, now)
    expect(normalized).toEqual({ existing, legacy: now })
    expect(expiredArchivedSessionIds(['existing', 'legacy'], normalized, now + ARCHIVE_RETENTION_MS - 1)).toEqual(['existing'])
    expect(expiredArchivedSessionIds(['existing', 'legacy'], normalized, now + ARCHIVE_RETENTION_MS)).toEqual(['existing', 'legacy'])
  })

  it('automatically deletes expired archives while preserving legacy archives for a fresh 24-hour window', async () => {
    const host = createMockHost()
    const now = Date.now()
    const remove = vi.fn(async () => undefined)
    const save = vi.fn(async (preferences: SidebarSessionPreferences) => preferences)
    host.deleteSession = remove
    host.getSidebarSessionPreferences = vi.fn(async (): Promise<SidebarSessionPreferences> => ({
      pinnedSessionIds: [],
      archivedSessionIds: ['layout', 'agent-run'],
      archivedSessionTimestamps: { layout: now - ARCHIVE_RETENTION_MS },
      orderedSessionIds: [],
      sessionOrderVersion: 2
    }))
    host.setSidebarSessionPreferences = save

    render(<App host={host} />)

    await waitFor(() => expect(remove).toHaveBeenCalledWith('layout'))
    expect(remove).not.toHaveBeenCalledWith('agent-run')
    await waitFor(() => expect(save.mock.calls.some(([value]) =>
      value.archivedSessionIds.length === 1
      && value.archivedSessionIds[0] === 'agent-run'
      && typeof value.archivedSessionTimestamps?.['agent-run'] === 'number'
      && !('layout' in (value.archivedSessionTimestamps ?? {}))
    )).toBe(true))
  })

  it('timestamps a newly archived session and keeps an expired archive when deletion fails', async () => {
    const host = createMockHost()
    const save = vi.fn(async (preferences: SidebarSessionPreferences) => preferences)
    host.setSidebarSessionPreferences = save
    const view = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const layoutRow = await waitFor(() => {
      const row = view.container.querySelector('[data-session-id="layout"]')
      if (!row) throw new Error('layout session row not rendered yet')
      return row as HTMLElement
    })
    fireEvent.click(within(layoutRow).getByRole('button', { name: '归档会话' }))
    await waitFor(() => expect(save.mock.calls.some(([value]) =>
      value.archivedSessionIds.includes('layout') && typeof value.archivedSessionTimestamps?.layout === 'number'
    )).toBe(true))
    view.unmount()

    const failing = createMockHost()
    failing.deleteSession = vi.fn(async () => { throw new Error('disk busy') })
    failing.getSidebarSessionPreferences = vi.fn(async (): Promise<SidebarSessionPreferences> => ({
      pinnedSessionIds: [], archivedSessionIds: ['layout'], archivedSessionTimestamps: { layout: Date.now() - ARCHIVE_RETENTION_MS }, orderedSessionIds: [], sessionOrderVersion: 2
    }))
    render(<App host={failing} />)
    expect(await screen.findByText(/自动删除过期归档失败：disk busy/)).toBeTruthy()
    expect(screen.getByText('已归档')).toBeTruthy()
  })

  it('constrains the real sidebar grid item and the shell row to the viewport', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    expect(css).toMatch(/\.pipiui-shell\s*\{[^}]*grid-template-rows:minmax\(0,1fr\)/s)
    expect(css).toMatch(/\.sb-root[^\{]*\{[^}]*min-height:0[^}]*max-height:100%[^}]*overflow:hidden/s)
    expect(css).toMatch(/\.chat-composer-stack\{[^}]*grid-row:3[^}]*flex:0 0 auto[^}]*flex-direction:column/s)
    expect(css).toMatch(/\.chat-viewport\{[^}]*min-height:0[^}]*overflow:hidden[^}]*grid-row:2/s)
  })

  it('uses pane-local scroll containers inside a viewport-bound shell', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(container.querySelector('.pipiui-shell')).toBeTruthy()
    expect(screen.getByTestId('sidebar').querySelector('.sb-scroll')).toBeTruthy()
    expect(screen.getByTestId('message-scroll').className).toContain('message-list')
    expect(container.querySelector('.tool-page.subagent-content')).toBeTruthy()
    expect(container.querySelector('.tool-quick-rail')).toBeTruthy()
  })

  it('mirrors the Swift titlebar by showing the session name as the window title', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(document.title).toBe('Electron 三栏界面'))
  })

  it('restores the last valid project and session after an App remount', async () => {
    const base = createMockHost()
    const projects: Project[] = [
      { id: 'p1', name: 'One', path: '/tmp/one' },
      { id: 'p2', name: 'Two', path: '/tmp/two' }
    ]
    const sessions: Session[] = [
      { id: 's1', projectId: 'p1', name: 'First', updatedAt: 2 },
      { id: 's2', projectId: 'p2', name: 'Remember me', updatedAt: 1 }
    ]
    const host: PipiHostAPI = {
      ...base,
      listProjects: async () => projects,
      listSessions: async projectId => sessions.filter(session => session.projectId === projectId),
      getSessionHistory: async () => []
    }
    const first = render(<App host={host} />)
    const secondRow = await waitFor(() => {
      const row = first.container.querySelector('[data-session-id="s2"]')
      if (!row) throw new Error('second session not loaded')
      return row as HTMLElement
    })
    fireEvent.click(secondRow)
    await waitFor(() => expect(JSON.parse(localStorage.getItem('pipiui:eui:last-session:v1') ?? '{}')).toEqual({ projectId: 'p2', sessionId: 's2' }))
    first.unmount()

    const second = render(<App host={host} />)
    await waitFor(() => expect(second.container.querySelector('[data-session-id="s2"]')?.getAttribute('aria-current')).toBe('true'))
    expect(document.title).toBe('Remember me')
  })

  it('falls back safely when the remembered session is malformed or deleted', async () => {
    localStorage.setItem('pipiui:eui:last-session:v1', '{not-json')
    const view = render(<App host={createMockHost()} />)
    await waitFor(() => expect(view.container.querySelector('[data-session-id="welcome"]')?.getAttribute('aria-current')).toBe('true'))
    expect(document.title).toBe('Electron 三栏界面')
  })

  it('keeps successful session lists when another project read fails and surfaces a dismissible error', async () => {
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      listProjects: async () => [
        { id: 'ok', name: 'OK', path: '/tmp/ok' },
        { id: 'broken', name: 'Broken', path: '/tmp/broken' }
      ],
      listSessions: async projectId => {
        if (projectId === 'broken') throw new Error('disk busy')
        return [{ id: 'kept', projectId: 'ok', name: 'Kept session', updatedAt: 1 }]
      },
      getSessionHistory: async () => []
    }
    const view = render(<App host={host} />)
    await waitFor(() => expect(view.container.querySelector('[data-session-id="kept"]')).toBeTruthy())
    expect((await screen.findByTestId('sidebar-project-error')).textContent).toContain('disk busy')
    fireEvent.click(screen.getByRole('button', { name: '关闭项目错误' }))
    expect(screen.queryByTestId('sidebar-project-error')).toBeNull()
    expect(view.container.querySelector('[data-session-id="kept"]')).toBeTruthy()
  })

  it('loads older history pages without gaps and preserves the newest successful page when an older read fails', async () => {
    const base = createMockHost()
    const newest = Array.from({ length: 500 }, (_, index) => ({
      id: `new-${index}`,
      role: 'user' as const,
      content: index === 499 ? 'newest marker' : `new ${index}`,
      timestamp: 1_000 + index
    }))
    const history = vi.fn(async (_sessionId: string, before?: number | string) => {
      if (before === undefined) return newest
      throw new Error('older page unavailable')
    })
    const host: PipiHostAPI = { ...base, getSessionHistory: history }
    render(<App host={host} />)
    expect(await screen.findByText('newest marker')).toBeTruthy()
    await waitFor(() => expect(history).toHaveBeenCalledWith('welcome', 'new-0', 500))
    expect((await screen.findByTestId('sidebar-project-error')).textContent).toContain('older page unavailable')
    expect(screen.getByText('newest marker')).toBeTruthy()
  })

  it('retries an incomplete cached history on reselection without hiding its newest page', async () => {
    const base = createMockHost()
    const newest = Array.from({ length: 500 }, (_, index) => ({
      id: `retry-new-${index}`,
      role: 'user' as const,
      content: index === 499 ? 'retry newest marker' : `retry new ${index}`,
      timestamp: 2_000 + index
    }))
    let olderAttempts = 0
    const history = vi.fn(async (sessionId: string, before?: number | string) => {
      if (sessionId === 'layout') return []
      if (before === undefined || before === 0) return newest
      olderAttempts += 1
      if (olderAttempts === 1) throw new Error('temporary older failure')
      return [{ id: 'retry-old', role: 'user' as const, content: 'recovered older marker', timestamp: 1 }]
    })
    const host: PipiHostAPI = { ...base, getSessionHistory: history }
    const view = render(<App host={host} />)
    expect(await screen.findByText('retry newest marker')).toBeTruthy()
    await screen.findByText(/temporary older failure/)

    fireEvent.click(view.container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(view.container.querySelector('[data-session-id="layout"]')?.getAttribute('aria-current')).toBe('true'))
    fireEvent.click(view.container.querySelector('[data-session-id="welcome"]')!)
    expect(screen.getByText('retry newest marker')).toBeTruthy()
    expect(await screen.findByText('recovered older marker')).toBeTruthy()
    expect(screen.getByText('retry newest marker')).toBeTruthy()
    expect(olderAttempts).toBe(2)
  })

  it('applies provisional and model-refined session titles from the host stream', async () => {
    const host = createMockHost()
    let listener: ((event: StreamEvent) => void) | undefined
    host.subscribeStream = (_sessionId, callback) => { listener = callback; return () => { listener = undefined } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    act(() => listener?.({ type: 'session_title', sessionId: 'welcome', title: '修复侧栏会话', source: 'provisional' }))
    expect(container.querySelector('[data-session-id="welcome"]')?.textContent).toContain('修复侧栏会话')
    await waitFor(() => expect(document.title).toBe('修复侧栏会话'))

    act(() => listener?.({ type: 'session_title', sessionId: 'welcome', title: 'Electron 会话创建修复', source: 'model' }))
    expect(container.querySelector('[data-session-id="welcome"]')?.textContent).toContain('Electron 会话创建修复')
  })

  it('renames the selected session from both the sidebar editor and a header double-click', async () => {
    const base = createMockHost()
    const renameSession = vi.fn(base.renameSession)
    const host: PipiHostAPI = { ...base, renameSession }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    const selectedRow = container.querySelector('[data-session-id="welcome"]') as HTMLElement
    fireEvent.click(within(selectedRow).getByRole('button', { name: '修改标题' }))
    const sidebarInput = within(selectedRow).getByRole('textbox', { name: '会话名称' })
    fireEvent.change(sidebarInput, { target: { value: '侧栏重命名' } })
    fireEvent.keyDown(sidebarInput, { key: 'Enter' })
    await waitFor(() => expect(renameSession).toHaveBeenCalledWith('welcome', '侧栏重命名'))
    await waitFor(() => expect(container.querySelector('.chat-header-title')?.textContent).toContain('侧栏重命名'))

    const headerTitle = container.querySelector('.chat-header-title-label') as HTMLElement
    fireEvent.doubleClick(headerTitle)
    const headerInput = within(container.querySelector('.chat-header-title') as HTMLElement).getByRole('textbox', { name: '会话名称' })
    fireEvent.change(headerInput, { target: { value: '顶栏重命名' } })
    fireEvent.keyDown(headerInput, { key: 'Enter' })
    await waitFor(() => expect(renameSession).toHaveBeenLastCalledWith('welcome', '顶栏重命名'))
    await waitFor(() => expect(container.querySelector('[data-session-id="welcome"]')?.textContent).toContain('顶栏重命名'))
    expect(document.title).toBe('顶栏重命名')
  })

  it('moves the right-pane toggle to the visible pane edge and persists collapse state', async () => {
    const first = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const shell = first.container.querySelector('.pipiui-shell')!
    expect(shell.className).not.toContain('tools-collapsed')
    const collapse = screen.getByLabelText('收起右栏')
    expect(collapse.closest('.tool-panel-header')).not.toBeNull()
    expect(collapse.querySelector('[data-pane-icon="collapse"]')).not.toBeNull()
    expect(first.container.querySelector('.chat-header [data-testid="toggle-tools"]')).toBeNull()
    fireEvent.click(collapse)
    expect(shell.className).toContain('tools-collapsed')
    const restore = screen.getByLabelText('展开右栏')
    expect(restore.closest('.chat-header-actions')).not.toBeNull()
    expect(restore.querySelector('[data-pane-icon="expand"]')).not.toBeNull()
    expect(restore.querySelector('[data-pane-icon="collapse"]')).toBeNull()
    expect(screen.queryByLabelText('收起右栏')).toBeNull()
    // persisted with a collapse marker inside the existing widths key
    expect(JSON.parse(localStorage.getItem('pipiui:eui-pane-widths')!)).toMatchObject({ sidebar: 258, tools: 368, sidebarCollapsed: false, toolsCollapsed: true })
    // the floating quick rail stays available while the pane is collapsed
    expect(first.container.querySelector('.tool-quick-rail')).toBeTruthy()
    fireEvent.click(restore)
    expect(shell.className).not.toContain('tools-collapsed')
    const reopened = screen.getByLabelText('收起右栏')
    expect(reopened.closest('.tool-panel-header')).not.toBeNull()
    expect(reopened.querySelector('[data-pane-icon="collapse"]')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('pipiui:eui-pane-widths')!)).toMatchObject({ toolsCollapsed: false })
    first.unmount()

    localStorage.setItem('pipiui:eui-pane-widths', JSON.stringify({ sidebar: 258, tools: 368, sidebarCollapsed: false, toolsCollapsed: true }))
    const second = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(second.container.querySelector('.pipiui-shell')!.className).toContain('tools-collapsed')
    expect(screen.getByLabelText('展开右栏')).toBeTruthy()
  })

  it('wires the header left-pane toggle: collapse, restore, persist', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const shell = container.querySelector('.pipiui-shell')!
    fireEvent.click(screen.getByLabelText('收起左栏'))
    expect(shell.className).toContain('sidebar-collapsed')
    expect(JSON.parse(localStorage.getItem('pipiui:eui-pane-widths')!)).toMatchObject({ sidebarCollapsed: true })
    fireEvent.click(screen.getByLabelText('展开左栏'))
    expect(shell.className).not.toContain('sidebar-collapsed')
    expect(JSON.parse(localStorage.getItem('pipiui:eui-pane-widths')!)).toMatchObject({ sidebarCollapsed: false })
    // the session tree is still reachable after re-expanding
    expect(screen.getByTestId('sidebar')).toBeTruthy()
  })

  it('keeps one sidebar toggle in the visible pane header and restores it from the chat header', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const header = container.querySelector('.chat-header')!
    const toggleSidebar = screen.getByLabelText('收起左栏')
    expect(toggleSidebar.closest('.sb-topbar')).not.toBeNull()
    expect(header.querySelector('[data-testid="toggle-sidebar"]')).toBeNull()
    expect(screen.getAllByTestId('toggle-sidebar')).toHaveLength(1)
    fireEvent.click(toggleSidebar)
    expect(container.querySelector('.pipiui-shell')!.className).toContain('sidebar-collapsed')
    const restoreSidebar = screen.getByLabelText('展开左栏')
    expect(restoreSidebar.closest('.chat-header')).not.toBeNull()
    expect(restoreSidebar.className).toContain('pane-restore-sidebar')
    expect(screen.getAllByTestId('toggle-sidebar')).toHaveLength(1)
    fireEvent.click(restoreSidebar)
    expect(container.querySelector('.pipiui-shell')!.className).not.toContain('sidebar-collapsed')
  })

  it('renders the floating quick rail over the chat column and toggles/closes tools', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const rail = container.querySelector('.tool-quick-rail')!
    expect(rail).toBeTruthy()
    expect(container.querySelector('.tool-panel-header')!.contains(rail)).toBe(true)
    expect(container.querySelector('.chat-viewport')!.contains(rail)).toBe(false)
    expect(rail.querySelectorAll('button')).toHaveLength(4)
    const browser = screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement
    await waitFor(() => expect(browser.disabled).toBe(false))
    // switching via the rail opens that tool and highlights it
    fireEvent.click(browser)
    expect(await screen.findByTestId('browser-panel')).toBeTruthy()
    expect(browser.className).toContain('active')
    // re-clicking the active tool closes the whole right pane; the rail stays
    fireEvent.click(screen.getByRole('button', { name: 'Browser' }))
    expect(container.querySelector('.pipiui-shell')!.className).toContain('tools-collapsed')
    expect(screen.getByRole('button', { name: 'Browser' }).className).not.toContain('active')
    const floating = container.querySelector('.tool-quick-rail')!
    expect(container.querySelector('.chat-viewport')!.contains(floating)).toBe(true)
    expect(container.querySelector('.tool-panel')!.contains(floating)).toBe(false)
    // clicking again reopens the same tool
    fireEvent.click(screen.getByRole('button', { name: 'Browser' }))
    expect(container.querySelector('.pipiui-shell')!.className).not.toContain('tools-collapsed')
    expect(await screen.findByTestId('browser-panel')).toBeTruthy()
    expect(container.querySelector('.tool-panel-header')!.contains(container.querySelector('.tool-quick-rail'))).toBe(true)
  })

  it('puts a back control on non-Subagents tool pages and returns to the previous tab', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByTestId('tool-panel-back')).toBeNull()
    const browser = screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement
    await waitFor(() => expect(browser.disabled).toBe(false))
    fireEvent.click(browser)
    expect(await screen.findByTestId('browser-panel')).toBeTruthy()
    const back = screen.getByTestId('tool-panel-back')
    expect(back.closest('.tool-panel-header')).not.toBeNull()
    expect(back.closest('.subagent-header')).toBeNull()
    fireEvent.click(back)
    expect(screen.queryByTestId('tool-panel-back')).toBeNull()
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
  })

  it('auto-collapses both panes on a narrow viewport and still allows manual re-expand', async () => {
    const media = { matches: true, media: '(max-width: 720px)', onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() } as unknown as MediaQueryList
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const shell = container.querySelector('.pipiui-shell')!
    expect(shell.className).toContain('sidebar-collapsed')
    expect(shell.className).toContain('tools-collapsed')
    // the main column stays present and the composer is usable
    expect(screen.getByTestId('chat-viewport')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框')).toBeTruthy()
    // header toggles can still show the panes at narrow width
    fireEvent.click(screen.getByLabelText('展开左栏'))
    expect(shell.className).not.toContain('sidebar-collapsed')
    fireEvent.click(screen.getByLabelText('展开右栏'))
    expect(shell.className).not.toContain('tools-collapsed')
    vi.unstubAllGlobals()
  })

  it('defines narrow breakpoints that collapse panes, overlay expanded panes, and cap overflow', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    // collapse flags zero the effective grid columns
    expect(css).toMatch(/\.pipiui-shell\.sidebar-collapsed\{[^}]*--sidebar-col:0px/)
    expect(css).toMatch(/\.pipiui-shell\.tools-collapsed\{[^}]*--tools-col:0px/)
    // existing 899px breakpoint stays viewport-proportional instead of fixed px
    expect(css).toMatch(/@media \(max-width:899px\)\{[^}]*minmax\(150px,28vw\)/)
    // 899px breakpoint keeps the stats/quota/balance row hugging the composer's
    // right edge: even when the options row wraps, the auto margin pushes the
    // wrapped row to the right edge of its flex line (never left-aligned).
    const narrow899 = css.match(/@media \(max-width:899px\)\{[^\n]*\}/)?.[0] ?? ''
    expect(narrow899).toMatch(/\.composer-stats\{[^}]*margin-left:auto/)
    expect(narrow899).not.toMatch(/\.composer-stats\{[^}]*margin-left:0/)
    // 720px breakpoint: auto-collapse hides panes, re-expanded panes become overlays
    const narrow = css.match(/@media \(max-width:720px\)\{[^\n]*\}/)?.[0] ?? ''
    expect(narrow).toContain('position:fixed')
    expect(narrow).toContain('width:min(86vw,340px)')
    expect(narrow).toMatch(/\.pipiui-shell\.sidebar-collapsed \.sb-root[^}]*display:none/)
    expect(narrow).toMatch(/\.pipiui-shell\.tools-collapsed \.tool-panel[^}]*display:none/)
    expect(narrow).toContain('.pipiui-shell .resize-handle{visibility:hidden}')
  })

  it('keeps collapsed drag handles in the grid flow instead of removing them', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    const desktop = css.slice(0, css.indexOf('@media'))
    // jsdom cannot lay out CSS grid, so pin the stylesheet contract instead:
    // a collapsed pane hides its handle with visibility so the handle keeps
    // owning its 6px track. display:none dropped the handle from auto-placement
    // and shifted the chat column into the 6px track — the whole chat vanished
    // behind a handle-width strip while the freed handle track showed the
    // hover-highlighted (accent blue) resize handle at chat width.
    expect(desktop).toMatch(/\.pipiui-shell\.sidebar-collapsed \.resize-handle-left[,{][^}]*visibility:hidden/)
    expect(desktop).toMatch(/\.pipiui-shell\.tools-collapsed \.resize-handle-right\{visibility:hidden\}/)
    expect(desktop).not.toMatch(/resize-handle-(left|right)[^{}]*\{[^}]*display:none/)
    // the dead 6px handle track collapses together with its pane
    expect(desktop).toMatch(/\.pipiui-shell\.sidebar-collapsed\{[^}]*grid-template-columns:0 0 minmax\(0,1fr\)/)
    expect(desktop).toMatch(/\.pipiui-shell\.tools-collapsed\{[^}]*grid-template-columns:var\(--sidebar-col\) 6px minmax\(0,1fr\) 0 0/)
    expect(desktop).toMatch(/\.pipiui-shell\.sidebar-collapsed\.tools-collapsed\{grid-template-columns:0 0 minmax\(0,1fr\) 0 0\}/)
  })

  it('shares one outer content track across every main chat row', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    const waitingCss = readFileSync(join(import.meta.dirname, 'waiting-placeholder.css'), 'utf8')
    const queueCss = readFileSync(join(import.meta.dirname, 'message-queue.css'), 'utf8')
    expect(css).toContain('--chat-content-max:780px')
    expect(css).toContain('--chat-content-gutter:16px')
    expect(css).toContain('--chat-scrollbar-gutter:6px')
    expect(css).toContain('--chat-content-width:calc(100% - var(--chat-content-gutter) - var(--chat-content-gutter))')
    expect(css).toMatch(/\.chat-composer-stack\{[^}]*padding-right:var\(--chat-scrollbar-gutter\)/)
    expect(css).toContain('.message-list [data-testid="virtuoso-scroller"]{scrollbar-gutter:stable}')
    expect(css).toMatch(/\.message,\s*\.system-message,\s*\.queue-operation-error,\s*\.composer\s*\{[^}]*width: var\(--chat-content-width\)[^}]*max-width: var\(--chat-content-max\)[^}]*margin-left: auto[^}]*margin-right: auto/)
    expect(css).toMatch(/\.message \{ padding-inline: 0; \}/)
    expect(waitingCss).toMatch(/\.waiting-placeholder\s*\{[^}]*max-width: var\(--chat-content-max, 780px\)[^}]*left: var\(--chat-content-gutter, 16px\)[^}]*right: calc\(var\(--chat-content-gutter, 16px\) \+ var\(--chat-scrollbar-gutter, 6px\)\)[^}]*margin-inline: auto/)
    expect(queueCss).toMatch(/\.message-queue\s*\{[^}]*width: var\(--chat-content-width, calc\(100% - 32px\)\)[^}]*max-width: var\(--chat-content-max, 780px\)[^}]*margin: 0 auto 8px/)
    expect(css).not.toContain('.tools-collapsed .chat-header{padding-right:54px}')
  })

  it('styles assistant markdown instead of falling back to UA defaults', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    // No Tailwind in this app, so streamdown's utility classes are inert: every
    // block element needs an explicit rule or it renders at UA defaults.
    for (const selector of ['.markdown h2', '.markdown ul, .markdown ol', '.markdown li', '.markdown blockquote', '.markdown table', '.markdown hr']) {
      expect(css).toContain(selector)
    }
    // One shared block rhythm, driven by a single knob.
    expect(css).toMatch(/\.pipiui-shell \{ --md-fs:[^;]+; --md-lh:[^;]+; --md-block:[^;]+; \}/)
    expect(css).toMatch(/\.markdown > \* \{ margin: 0 0 var\(--md-block\); \}/)
    // `anywhere` belongs on inline code only — on the whole body it shreds mixed CJK/Latin wrapping.
    expect(css).toMatch(/\.markdown \{[^}]*overflow-wrap: break-word;[^}]*line-break: strict;/)
    expect(css).toMatch(/\.markdown :not\(pre\) > code \{[^}]*overflow-wrap: anywhere;/)
    // Markdown code blocks scroll horizontally; tool output keeps wrapping.
    expect(css).toMatch(/\.markdown pre \{[^}]*white-space: pre;/)
    expect(css).toMatch(/\.tool-card pre,\.tool-result\{[^}]*white-space:pre-wrap/)
  })

  it('uses the pane headers as macOS hiddenInset chrome in Electron only', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 PipiUI Electron/32.3.3', configurable: true })
    try {
      const { container } = render(<App host={createMockHost()} />)
      await screen.findAllByText('Electron 三栏界面')
      expect(container.querySelector('.pipiui-shell')?.className).toContain('electron-chrome')
      // Pane headers own the drag regions; an extra grid child would shift every pane one column.
      expect(container.querySelector('.titlebar-drag')).toBeNull()
      expect(container.querySelector('.titlebar-drag-title')).toBeNull()
      // header title stays left-aligned: actions pushed right via margin-left:auto, no space-between centering
      const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
      expect(css).toMatch(/\.chat-header\{[^}]*\}/)
      expect(css.match(/\.chat-header\{[^}]*\}/)?.[0]).not.toContain('justify-content:space-between')
      expect(css).toMatch(/\.chat-header-actions\{[^}]*margin-left:auto/)
      expect(css).toMatch(/\.electron-chrome \.sb-topbar[^}]*padding-left:88px/)
      expect(css).toMatch(/\.electron-chrome \.chat-header-title-label\{[^}]*-webkit-app-region:no-drag/)
      expect(css).toMatch(/\.electron-chrome \.chat-header-title-label\{[^}]*user-select:none/)
      expect(css).toMatch(/\.tool-quick-rail-header\{[^}]*flex:0 0 auto/)
      expect(css).not.toMatch(/\.tool-quick-rail-header\{[^}]*flex:1/)
      expect(css).toMatch(/\.chat-header-title\{[^}]*padding:0 10px/)
      expect(css).toMatch(/\.pipiui-shell\{[^}]*height:100%;[^}]*max-height:100%/)
      expect(css).not.toMatch(/\.pipiui-shell\{[^}]*100dvh/)
      expect(css).not.toContain('.titlebar-drag-title{')
    } finally {
      // userAgent normally lives on Navigator.prototype; unshadow it either way.
      if (descriptor) Object.defineProperty(navigator, 'userAgent', descriptor)
      else delete (navigator as { userAgent?: unknown }).userAgent
    }

    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(container.querySelector('.pipiui-shell')?.className).not.toContain('electron-chrome')
  })

  it('switches the icon tool rail and mounts the Browser host panel', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.getAllByText('PipiUI').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
    await waitFor(() => expect(container.querySelector('.tool-rail-running')?.textContent).toBe('1'))
    const browser = screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement
    await waitFor(() => expect(browser.disabled).toBe(false))
    fireEvent.click(browser)
    expect(await screen.findByTestId('browser-panel')).toBeTruthy()
    expect(browser.className).toContain('active')
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull()
  })

  it('opens a main assistant Markdown card in the expanded Document panel using the selected project path', async () => {
    const host = createMockHost()
    const readDocument = vi.spyOn(host, 'readDocument')
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const collapse = screen.getByRole('button', { name: '收起右栏' })
    fireEvent.click(collapse)
    expect(container.querySelector('.pipiui-shell')?.className).toContain('tools-collapsed')

    fireEvent.click(await screen.findByRole('button', { name: '打开文档 README.md' }))

    await waitFor(() => expect(container.querySelector('.pipiui-shell')?.className).not.toContain('tools-collapsed'))
    expect(screen.getByRole('button', { name: 'Document' }).className).toContain('active')
    await waitFor(() => expect(readDocument).toHaveBeenCalledWith('/Users/demo/code/pipiui/README.md'))
    expect((await screen.findByLabelText('文档内容 README.md')).textContent).toContain('Mock host preview')
  })

  it('opens collapsed tools on a newly started subagent without stealing an already open tab', async () => {
    const host = createMockHost()
    let pushAgent: ((event: AgentEvent) => void) | undefined
    host.listAgents = async () => []
    host.subscribeAgents = listener => { pushAgent = listener; return () => { pushAgent = undefined } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    fireEvent.click(screen.getByRole('button', { name: 'Subagents' }))
    expect(container.querySelector('.pipiui-shell')?.className).toContain('tools-collapsed')
    act(() => pushAgent?.({ type: 'agent', agent: { agentId: 'fresh', runId: 'run-1', sessionId: 'welcome', name: 'explore', task: 'new work', state: 'running' } }))
    await waitFor(() => expect(container.querySelector('.pipiui-shell')?.className).not.toContain('tools-collapsed'))
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
    expect(container.querySelector('.tool-rail-running')?.textContent).toBe('1')

    const browser = screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement
    await waitFor(() => expect(browser.disabled).toBe(false))
    fireEvent.click(browser)
    expect(browser.className).toContain('active')
    act(() => pushAgent?.({ type: 'agent', agent: { agentId: 'second', runId: 'run-2', sessionId: 'welcome', name: 'reviewer', task: 'more work', state: 'running' } }))
    await waitFor(() => expect(container.querySelector('.tool-rail-running')?.textContent).toBe('2'))
    expect(browser.className).toContain('active')
  })

  it('sends a narrowly scoped status-check prompt when the user clicks the stale-channel warning', async () => {
    const host = createMockHost()
    const now = Date.now()
    host.listAgents = async () => [
      { agentId: 'ghost', runId: 'r-ghost', sessionId: 'welcome', name: 'explore', task: 'vanished', state: 'running', createdAt: now - 11 * 60_000, updatedAt: now - 11 * 60_000 },
    ]
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('subagent-manual-status-check'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalled())
    const prompt = sendPrompt.mock.calls[0]?.[1] as string
    expect(prompt).toContain('`ghost`')
    expect(prompt).toContain('subagent_status')
    expect(prompt).toContain('不要自动重新派发')
  })

  it.each([
    ['Subagents', ['Subagents', 'Browser', 'Document', 'Terminal']],
    ['Browser', ['Browser', 'Document', 'Terminal', 'Subagents']],
    ['Document', ['Document', 'Terminal', 'Subagents', 'Browser']],
    ['Terminal', ['Terminal', 'Subagents', 'Browser', 'Document']],
  ] as const)('keeps native Browser input away from the rail across three cycles starting at %s', async (_start, cycle) => {
    const host = createMockHost()
    host.terminal = { open: vi.fn(async () => ({ id: 'rail-terminal', title: 'Terminal', cwd: '/tmp' })), write: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), clear: vi.fn(async () => undefined), close: vi.fn(async () => undefined), subscribe: vi.fn(() => () => undefined) }
    host.capabilities = async () => ({ computerUse: false, revealInFinder: true, terminal: true, documents: true, browser: true, git: true, plan: false, retainedWorktreeDisposition: false })
    const setViewBounds = vi.spyOn(host.browser!, 'setViewBounds')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const click = (name: 'Subagents' | 'Browser' | 'Document' | 'Terminal') => fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement).disabled).toBe(false))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Terminal' }) as HTMLButtonElement).disabled).toBe(false))
    let browserOpened = false
    for (const name of [...cycle, ...cycle, ...cycle]) {
      click(name)
      if (name === 'Browser') {
        browserOpened = true
        await waitFor(() => expect(setViewBounds.mock.calls.at(-1)?.[1].visible).toBe(true))
      } else if (browserOpened) {
        await waitFor(() => expect(setViewBounds.mock.calls.at(-1)).toEqual(['welcome', { x: 0, y: 0, width: 0, height: 0, visible: false }]))
      }
    }
    expect(screen.getByTestId('browser-panel')).toBeTruthy()
    expect(Boolean(screen.getByTestId('browser-panel').closest('[hidden]'))).toBe(cycle.at(-1) !== 'Browser')
  })

  it('keeps the tool rail in a viewport-level pointer hit layer independent of panel contents', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    const floatRule = [...css.matchAll(/\.tool-quick-rail-float\{[^}]*\}/g)].map(match => match[0]).find(rule => rule.includes('position:fixed')) ?? ''
    expect(floatRule).toContain('position:fixed')
    expect(floatRule).toContain('flex-direction:column')
    expect(floatRule).toContain('pointer-events:auto')
    expect(floatRule).toMatch(/z-index:(?:3[5-9]|[4-9]\d|\d{3,})/)
    expect(floatRule).toContain('right:calc(var(--tools-col) + 16px)')
    const headerRule = [...css.matchAll(/\.tool-quick-rail-header\{[^}]*\}/g)].map(match => match[0])[0] ?? ''
    expect(headerRule).toContain('flex-direction:row')
  })

  it('reveals Browser when the host reports an agent browser action', async () => {
    const host = createMockHost()
    const selectSession = vi.spyOn(host.browser!, 'selectSession')
    const listeners = new Set<(event: any) => void>()
    const subscribe = host.browser!.subscribe.bind(host.browser)
    host.browser!.subscribe = listener => {
      listeners.add(listener)
      const unsubscribe = subscribe(listener)
      return () => { listeners.delete(listener); unsubscribe() }
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement).disabled).toBe(false))
    await waitFor(() => expect(selectSession).toHaveBeenCalledWith('welcome'))

    listeners.forEach(listener => listener({ type: 'reveal', sessionId: 'layout' }))
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')

    listeners.forEach(listener => listener({ type: 'reveal', sessionId: 'welcome' }))

    expect(await screen.findByTestId('browser-panel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Browser' }).className).toContain('active')
  })

  it('reveals the exact Terminal only for the currently selected chat session', async () => {
    const host = createMockHost()
    const listeners = new Set<(event: import('@pipi/host-api').TerminalEvent) => void>()
    host.terminal = {
      open: vi.fn(async options => ({ id: 'term-welcome', title: '终端', cwd: '/tmp', sessionId: options?.sessionId })),
      write: vi.fn(async () => undefined), resize: vi.fn(async () => undefined), clear: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined), subscribeAll: listener => { listeners.add(listener); return () => listeners.delete(listener) }
    }
    host.capabilities = async () => ({ computerUse: false, revealInFinder: true, terminal: true, browser: true, git: true, plan: false, retainedWorktreeDisposition: false })
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Terminal' }) as HTMLButtonElement).disabled).toBe(false))
    listeners.forEach(listener => listener({ type: 'reveal', sessionId: 'layout', terminalId: 'term-layout' }))
    expect(screen.getByRole('button', { name: 'Subagents' }).className).toContain('active')
    listeners.forEach(listener => listener({ type: 'opened', sessionId: 'welcome', terminal: { id: 'term-agent', title: 'ssh', sessionId: 'welcome' } }))
    listeners.forEach(listener => listener({ type: 'reveal', sessionId: 'welcome', terminalId: 'term-agent' }))
    expect(await screen.findByTestId('xterm-surface-term-agent')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Terminal' }).className).toContain('active')
    expect(screen.getByRole('tab', { name: 'ssh' }).getAttribute('aria-selected')).toBe('true')

    const layoutRow = document.querySelector('[data-session-id="layout"]') as HTMLElement
    fireEvent.click(layoutRow)
    await waitFor(() => expect(layoutRow.getAttribute('aria-current')).toBe('true'))
    listeners.forEach(listener => listener({ type: 'opened', sessionId: 'layout', terminal: { id: 'term-layout', title: 'layout shell', sessionId: 'layout' } }))
    listeners.forEach(listener => listener({ type: 'reveal', sessionId: 'layout', terminalId: 'term-layout' }))
    expect(await screen.findByTestId('xterm-surface-term-layout')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'layout shell' }).getAttribute('aria-selected')).toBe('true')
    listeners.forEach(listener => listener({ type: 'reveal', sessionId: 'welcome', terminalId: 'term-agent' }))
    expect(screen.getByRole('tab', { name: 'layout shell' }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps Subagent selection/disclosure/scroll and the terminal instance across rail switches', async () => {
    const base = createMockHost()
    const terminalHost = {
      open: vi.fn(async () => ({ id: 'real-host-terminal', title: '终端', cwd: '/tmp/pipiui' })),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined)
    }
    const host: PipiHostAPI = { ...base, terminal: terminalHost, capabilities: async () => ({ computerUse: false, revealInFinder: true, terminal: true, documents: true, browser: true, git: true, plan: false, retainedWorktreeDisposition: false }) }
    const open = vi.spyOn(host.terminal!, 'open')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    const researchRow = await screen.findByTestId('agent-row-research')
    fireEvent.click(researchRow.querySelector('.agent-select')!)
    await waitFor(() => expect(researchRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    const subagentTranscript = screen.getByTestId('subagent-transcript')
    expect(within(subagentTranscript).queryByText(/已读取主界面实现/)).toBeNull()
    // Logs stream in via subscribeAgentLog; wait for the unified step card
    // (thinking + read combined, like the main agent transcript).
    await within(subagentTranscript).findByRole('button', { name: /个步骤/ })
    // expandSteps keeps only the outer card open; nested ordinary tools stay folded.
    const readDetail = await within(subagentTranscript).findByRole('button', { name: /^read/ })
    expect(readDetail.getAttribute('aria-expanded')).toBe('false')
    expect(within(subagentTranscript).queryByText(/已读取主界面实现/)).toBeNull()
    // Thinking card is collapsed by default; expand to verify content persists.
    const thinkingDetail = await within(subagentTranscript).findByRole('button', { name: /^Thinking/ })
    fireEvent.click(thinkingDetail)
    await screen.findByText(/正在梳理 packages\/ui 的组件边界/)
    const agentLog = screen.getByTestId('subagent-transcript-scroll')
    agentLog.scrollTop = 48

    fireEvent.click(screen.getByRole('button', { name: 'Document' }))
    fireEvent.click(screen.getByRole('button', { name: 'Subagents' }))
    await waitFor(() => expect(researchRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByText(/正在梳理 packages\/ui 的组件边界/)).toBeTruthy()
    expect(screen.getByTestId('subagent-transcript-scroll').scrollTop).toBe(48)

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    const terminal = xtermHarness.instances[0]
    const writesBeforeSwitch = [...terminal.write.mock.calls]
    expect(open).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Document' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    expect(xtermHarness.instances[0]).toBe(terminal)
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(terminal.write.mock.calls).toEqual(writesBeforeSwitch)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('keeps the explicitly opened Document and reader scroll position across a rail switch', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByRole('button', { name: '打开文档 README.md' }))
    const preview = await screen.findByLabelText('文档内容 README.md')
    const reader = preview.closest('.document-reader') as HTMLElement
    reader.scrollTop = 47

    fireEvent.click(screen.getByRole('button', { name: 'Subagents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Document' }))
    const restoredPreview = await screen.findByLabelText('文档内容 README.md')
    expect(restoredPreview).toBe(preview)
    expect((restoredPreview.closest('.document-reader') as HTMLElement).scrollTop).toBe(47)
    expect(screen.queryByText(/文件列表|个文件|正在同步/)).toBeNull()
  })

  it('disables Browser for a remote host without browser capability', async () => {
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, capabilities: async () => ({ computerUse: false, revealInFinder: true, terminal: true, browser: false, plan: false, retainedWorktreeDisposition: false }) }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const browser = screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement
    await waitFor(() => expect(browser.disabled).toBe(true))
    expect(screen.queryByTestId('browser-panel')).toBeNull()
  })

  it('does not advertise or provide a local terminal when no real host terminal exists', async () => {
    const host = createMockHost()
    expect(host.terminal).toBeUndefined()
    expect(await host.capabilities()).toMatchObject({ terminal: false })
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Terminal' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('disables server-only browser, terminal, and unavailable Finder controls', async () => {
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, capabilities: async () => ({ computerUse: false, revealInFinder: false, terminal: false, browser: false, plan: false, retainedWorktreeDisposition: false }) }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Browser' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Terminal' }) as HTMLButtonElement).disabled).toBe(true)
    })
    fireEvent.click(screen.getByLabelText('PipiUI 项目菜单'))
    expect((screen.getByRole('menuitem', { name: /在 Finder 中显示/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the project git branch in the chat header and hides it without the capability', async () => {
    render(<App host={createMockHost()} />)
    const branch = await screen.findByTestId('git-branch-button')
    expect(branch.textContent).toContain('pipiui/electron-git-bran')
    expect(branch.closest('.chat-header')).not.toBeNull()
    cleanup()
    const base = createMockHost()
    render(<App host={{ ...base, capabilities: async () => ({ computerUse: false, revealInFinder: true, terminal: true, browser: true, git: false, plan: false, retainedWorktreeDisposition: false }) }} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(screen.queryByTestId('git-branch-button')).toBeNull())
  })

  it('shows a read-only lease and allows explicit takeover', async () => {
    const forceTakeoverSessionLease = vi.fn(async (sessionId: string) => ({ sessionId, writable: true }))
    const host: PipiHostAPI = { ...createMockHost(), getSessionLease: async sessionId => ({ sessionId, writable: false, holder: { protocolVersion: 1, holder: 'pipiui-swift', pid: 1, hostname: 'mac', acquiredAt: '', heartbeatAt: '', expiresAt: '' } }), forceTakeoverSessionLease }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect((screen.getByLabelText('消息输入框') as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByText(/由 pipiui-swift 运行中/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('lease-takeover-header'))
    await waitFor(() => expect(forceTakeoverSessionLease).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByLabelText('消息输入框') as HTMLTextAreaElement).disabled).toBe(false))
  })

  it('keeps the fixed Composer and explicit takeover available for a real canWrite/ownerLabel read-only lease', async () => {
    const base = createMockHost()
    const forceTakeoverSessionLease = vi.fn(async (sessionId: string) => ({ sessionId, canWrite: true, ownerLabel: 'this-client' } as unknown as import('@pipi/host-api').SessionLease))
    const host: PipiHostAPI = {
      ...base,
      getSessionLease: async sessionId => ({ sessionId, canWrite: false, ownerLabel: 'pipiui-electron' } as unknown as import('@pipi/host-api').SessionLease),
      forceTakeoverSessionLease,
      listQueue: async sessionId => [queuedMessage('lease-queued', sessionId, '只读时仍可浏览的队列项')]
    }
    const { container, unmount } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const stack = screen.getByTestId('chat-composer-stack')
    const textarea = within(stack).getByLabelText('消息输入框') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
    expect(screen.getByText(/由 pipiui-electron 运行中/)).toBeTruthy()
    expect(within(stack).getByTestId('composer-read-only').textContent).toContain('pipiui-electron')
    expect(within(stack).getByTestId('composer-lease-takeover')).toBeTruthy()
    expect(await within(stack).findByTestId('composer-session-stats')).toBeTruthy()
    expect(within(stack).getByTestId('stats-pill')).toBeTruthy()
    expect(container.querySelector('.chat-column')?.children).toHaveLength(3)

    fireEvent.click(await screen.findByTestId('message-queue-toggle'))
    expect((screen.getByTestId('queue-edit-0') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('queue-remove-0') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(stack).getByTestId('composer-lease-takeover'))
    await waitFor(() => expect(forceTakeoverSessionLease).toHaveBeenCalledWith('welcome'))
    await waitFor(() => expect(textarea.disabled).toBe(false))
    unmount()

    const writableHost: PipiHostAPI = {
      ...base,
      getSessionLease: async sessionId => ({ sessionId, canWrite: true, ownerLabel: 'this-client' } as unknown as import('@pipi/host-api').SessionLease)
    }
    render(<App host={writableHost} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect((screen.getByLabelText('消息输入框') as HTMLTextAreaElement).disabled).toBe(false))
    expect(screen.queryByTestId('composer-read-only')).toBeNull()
    expect(screen.getByTestId('composer-session-stats')).toBeTruthy()
  })

  it('uses an injected host and keeps host effects stable while composing', async () => {
    const base = createMockHost()
    const listProjects = vi.fn(async () => [{ id: 'injected', name: 'Injected Project', path: '/tmp/injected' }])
    const listSessions = vi.fn(async () => [{ id: 'injected-session', projectId: 'injected', name: 'Injected Session', updatedAt: Date.now() }])
    const host: PipiHostAPI = { ...base, listProjects, listSessions, getSessionHistory: async () => [] }
    render(<App host={host} />)
    await screen.findByText('Injected Project')
    expect(screen.queryByText('Electron 三栏界面')).toBeNull()
    expect(screen.queryByText('/Users/demo/code/pipiui')).toBeNull()
    // the header shows only the session title — project paths are not rendered anymore
    expect(screen.queryByText('/tmp/injected')).toBeNull()
    const composer = screen.getByLabelText('消息输入框')
    fireEvent.change(composer, { target: { value: 'a' } }); fireEvent.change(composer, { target: { value: 'ab' } }); fireEvent.change(composer, { target: { value: 'abc' } })
    expect((composer as HTMLTextAreaElement).value).toBe('abc')
    expect(listProjects).toHaveBeenCalledTimes(1)
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('keeps the context ring/used-window and adds the Swift-style quota pill, both from the selected session', async () => {
    const base = createMockHost()
    const streamListeners = new Map<string, (event: any) => void>()
    const getSessionStats = vi.fn(async (sessionId?: string) => ({
      sessionId: sessionId ?? 'welcome',
      tokens: { input: 100, output: 20, cacheRead: 10, cacheWrite: 0, total: 130 },
      cost: 0.01,
      contextUsage: { tokens: sessionId === 'layout' ? 40_000 : 76_000, contextWindow: 272_000, percent: sessionId === 'layout' ? 15 : 28 }
    }))
    const getQuotaSnapshot = vi.fn(async (sessionId?: string) => sessionId === 'layout'
      ? { provider: 'codex', accountLabel: 'Codex 账号额度', windows: [{ id: 'primary', usedPercent: 63, label: '5h', title: '5小时额度' }, { id: 'secondary', usedPercent: 12, label: '周', title: '周额度' }] }
      : { provider: 'codex', accountLabel: 'Codex 账号额度', windows: [{ id: 'primary', usedPercent: 4, label: '5h', title: '5小时额度' }, { id: 'secondary', usedPercent: 12, label: '周', title: '周额度' }] })
    const host: PipiHostAPI = {
      ...base,
      getSessionStats,
      getQuotaSnapshot,
      subscribeStream: (sessionId, listener) => { streamListeners.set(sessionId, listener); return () => streamListeners.delete(sessionId) }
    }
    const { container } = render(<App host={host} />)
    const composerStats = await screen.findByTestId('composer-session-stats')
    expect(composerStats.closest('.composer-options')).toBeTruthy()
    const optionsRow = composerStats.closest('.composer-options')!
    // Swift parity: the status row is an independent sibling below the input
    // card, never nested inside the capsule that wraps the textarea.
    expect(optionsRow.parentElement?.classList.contains('composer')).toBe(true)
    expect(optionsRow.previousElementSibling?.classList.contains('composer-card')).toBe(true)
    expect(container.querySelector('.composer-card .composer-options')).toBeNull()
    // Left group: model + thinking chips stay left inside the options row.
    expect(screen.getByTestId('model-chip')).toBeTruthy()
    expect(optionsRow.querySelector('.composer-options-left .model-chip')).toBeTruthy()
    expect(optionsRow.querySelector('.composer-options-left .thinking-chip')).toBeTruthy()
    // Right group: stats + quota stay inside the same right-aligned row.
    expect(optionsRow.querySelector('.composer-stats .session-stats-pill')).toBeTruthy()
    expect(optionsRow.querySelector('.composer-stats .quota-pill')).toBeTruthy()
    await waitFor(() => expect(getSessionStats).toHaveBeenCalledWith('welcome'))
    await waitFor(() => expect(getQuotaSnapshot).toHaveBeenCalledWith('welcome'))
    // Context indicator unchanged: ring + used/window capsule.
    expect(screen.getByTestId('stats-pill').textContent).toContain('76k/272k')
    expect(screen.getByTestId('context-progress-ring')).toBeTruthy()
    // Quota sits next to it in the same composer footer, Swift-selected single period.
    expect(screen.getByTestId('quota-pill').textContent).toBe('周 12%')
    expect(screen.getAllByTestId('quota-pill')).toHaveLength(1)
    // Both stay inside the same right-aligned stats row.
    expect(composerStats.querySelector('.session-stats-pill')).toBeTruthy()
    expect(composerStats.querySelector('.quota-pill')).toBeTruthy()
    // Quota styling is self-contained: other footer controls keep their own classes/shapes.
    expect(container.querySelector('.model-chip')?.className).toBe('model-chip')
    expect(container.querySelector('.thinking-chip')?.className).toBe('thinking-chip')
    expect(composerStats.querySelector('.model-chip')).toBeNull()

    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(getSessionStats).toHaveBeenLastCalledWith('layout'))
    await waitFor(() => expect(getQuotaSnapshot).toHaveBeenLastCalledWith('layout'))
    expect(screen.getByTestId('stats-pill').textContent).toContain('40k/272k')
    expect(screen.getByTestId('quota-pill').textContent).toBe('5h 63%')

    const callsBeforeSettle = getSessionStats.mock.calls.length
    streamListeners.get('layout')?.({ type: 'status', sessionId: 'layout', status: 'settled' })
    await waitFor(() => expect(getSessionStats.mock.calls.length).toBe(callsBeforeSettle + 1))
    // Selected session: terminal-status notification is consumed, so the sidebar
    // row falls back to idle (no red dot) — only live activity stays visible.
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('idle'))

    cleanup()
    // No quota source: the context pill remains and nothing quota-like renders.
    localStorage.removeItem('pipiui:eui:last-session:v1')
    render(<App host={{ ...base, getSessionStats, getQuotaSnapshot: async () => null }} />)
    expect((await screen.findByTestId('stats-pill')).textContent).toContain('76k/272k')
    expect(screen.getByTestId('context-progress-ring')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('quota-pill')).toBeNull())
    // No quota source: the right group still renders stats, and only stats.
    const statsOnly = await screen.findByTestId('composer-session-stats')
    expect(statsOnly.querySelector('.session-stats-pill')).toBeTruthy()
    expect(statsOnly.querySelector('.quota-pill')).toBeNull()
  })

  it('shows the Codex quota fixture next to the context pill in the browser/dev fallback after selecting Codex', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByTestId('quota-pill')).toBeNull()
    fireEvent.click(screen.getByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-openai-codex'))
    expect((await screen.findByTestId('quota-pill')).textContent).toBe('周 12%')
    // Context indicator is untouched by the quota fixture.
    expect(screen.getByTestId('stats-pill').textContent).toContain('200k')
    expect(screen.getByTestId('context-progress-ring')).toBeTruthy()
  })

  it('shows the DeepSeek balance fixture instead of a quota pill, then swaps back to Codex quota', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByTestId('balance-pill')).toBeNull()
    expect(screen.queryByTestId('quota-pill')).toBeNull()
    fireEvent.click(screen.getByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-deepseek-deepseek-v3'))
    expect((await screen.findByTestId('balance-pill')).textContent).toBe('¥88.00')
    expect(screen.queryByTestId('quota-pill')).toBeNull()
    // Codex quota wins over balance for the same capsule slot.
    fireEvent.click(screen.getByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-openai-codex'))
    expect((await screen.findByTestId('quota-pill')).textContent).toBe('周 12%')
    expect(screen.queryByTestId('balance-pill')).toBeNull()
  })

  it('follows system color-scheme changes', async () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined
    const media = { matches: false, media: '(prefers-color-scheme: dark)', onchange: null, addEventListener: (_: string, callback: (event: MediaQueryListEvent) => void) => { listener = callback }, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => true } as MediaQueryList
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(container.querySelector('.pipiui-shell')?.getAttribute('data-theme')).toBe('light')
    Object.defineProperty(media, 'matches', { value: true, configurable: true })
    listener?.({ matches: true } as MediaQueryListEvent)
    await waitFor(() => expect(container.querySelector('.pipiui-shell')?.getAttribute('data-theme')).toBe('dark'))
    vi.unstubAllGlobals()
  })

  it('mounts the standalone Sidebar without old blue-dot rows and maps the selected model', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.getByTestId('sidebar')).toBeTruthy()
    expect(screen.getByText('项目')).toBeTruthy()
    expect(container.querySelector('.status-dot')).toBeNull()
    expect(container.querySelector('.side-scroll')).toBeNull()

    const welcome = container.querySelector('[data-session-id="welcome"]')!
    // welcome carries the running explore fixture, so its row reflects that status.
    expect(welcome.getAttribute('data-status')).toBe('subagents-running')
    expect(welcome.getAttribute('aria-current')).toBe('true')
    expect(welcome.querySelector('[data-testid="provider-logo-anthropic"]')).toBeTruthy()
    // Sessions carry their own model metadata: non-selected rows show their own provider logo.
    expect(container.querySelector('[data-session-id="layout"] [data-testid="provider-logo-openai"]')).toBeTruthy()
    expect(container.querySelector('[data-session-id="agent-run"] [data-testid="provider-logo-deepseek"]')).toBeTruthy()
    // A session without model data still falls back to the neutral logo.
    expect(container.querySelector('[data-session-id="tokens"] [data-testid="provider-logo-unknown"]')).toBeTruthy()

    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('aria-current')).toBe('true'))
  })

  it('restores sidebar expansion/pins/page size and wires more/search/new/project menu behavior', async () => {
    const workspace = [
      { id: 'pipiui', name: 'PipiUI', path: '/Users/demo/code/pipiui' },
      { id: 'website', name: 'Website', path: '/Users/demo/code/website' },
      { id: 'design', name: 'Design System', path: '/Users/demo/code/design-system' }
    ]
    localStorage.setItem(sidebarPreferencesKey(workspace), JSON.stringify({ expandedIds: ['pipiui'], pinnedSessionIds: ['agent-run'], visibleLimit: 1 }))
    const host = createMockHost()
    const newSession = vi.spyOn(host, 'newSession')
    const revealProject = vi.spyOn(host, 'revealProject')
    const first = render(<App host={host} />)
    await screen.findByText('PipiUI')
    await waitFor(() => expect(screen.getByTestId('show-more')).toBeTruthy())
    expect(screen.getByText('置顶')).toBeTruthy()
    expect(screen.getByText('Subagent 面板验收')).toBeTruthy()
    expect(screen.queryByText('Website')).toBeNull()
    fireEvent.click(screen.getByTestId('show-more'))
    expect(await screen.findByText('Website')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索所有会话' }), { target: { value: 'Landing' } })
    expect(await screen.findByText('Landing page')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索所有会话' }), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: /在 PipiUI 新建会话/ }))
    await waitFor(() => expect(newSession).toHaveBeenCalledWith('pipiui'))
    fireEvent.click(screen.getByLabelText('PipiUI 项目菜单'))
    expect(screen.queryByRole('menuitem', { name: '新建会话' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '在 Finder 中显示' }))
    await waitFor(() => expect(revealProject).toHaveBeenCalledWith('pipiui'))
    fireEvent.click(screen.getByLabelText('PipiUI 项目菜单'))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const renameInput = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(renameInput, { target: { value: '我的仓库' } })
    fireEvent.keyDown(renameInput, { key: 'Enter' })
    expect(await screen.findByText('我的仓库')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('我的仓库 项目菜单'))
    expect((screen.getByRole('menuitem', { name: /移除项目/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /收起项目 我的仓库/ }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(sidebarPreferencesKey(workspace))!).expandedIds).toEqual([]))
    first.unmount()
    render(<App host={createMockHost()} />)
    await screen.findByText('PipiUI')
    expect(screen.getByRole('button', { name: /展开项目 PipiUI/ })).toBeTruthy()
  })

  it('only toggles a project folder and does not switch the selected session', async () => {
    const base = createMockHost()
    const listSessions = vi.fn(base.listSessions)
    const host: PipiHostAPI = { ...base, listSessions }
    const { container } = render(<App host={host} />)

    await waitFor(() => expect(container.querySelector('.chat-header-title-label')?.textContent).toBe('Electron 三栏界面'))
    const websiteToggle = await screen.findByRole('button', { name: '收起项目 Website' })
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(4))
    const initialListCalls = listSessions.mock.calls.length

    fireEvent.click(websiteToggle)
    await waitFor(() => expect(screen.getByRole('button', { name: '展开项目 Website' })).toBeTruthy())
    await act(async () => { await Promise.resolve() })

    expect(listSessions).toHaveBeenCalledTimes(initialListCalls)
    expect(container.querySelector('[data-session-id="welcome"]')?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('.chat-header-title-label')?.textContent).toBe('Electron 三栏界面')
  })

  it('uses host semantic sidebar preferences after one-time local migration while keeping disclosure local', async () => {
    const host = createMockHost()
    const workspace = await host.listProjects()
    localStorage.setItem(sidebarPreferencesKey(workspace), JSON.stringify({ expandedIds: ['pipiui'], pinnedSessionIds: ['agent-run'], archivedSessionIds: [], visibleLimit: 2 }))
    localStorage.setItem('pipiui:eui:sidebar-semantic-host:v1', '1')
    host.getSidebarSessionPreferences = vi.fn(async () => ({ pinnedSessionIds: ['welcome'], archivedSessionIds: ['layout'], orderedSessionIds: [] }))
    const save = vi.fn(async (preferences: SidebarSessionPreferences) => preferences)
    host.setSidebarSessionPreferences = save

    render(<App host={host} />)
    await waitFor(() => expect(host.getSidebarSessionPreferences).toHaveBeenCalled())
    expect(await screen.findByText('置顶')).toBeTruthy()
    expect(screen.getAllByText('Electron 三栏界面').length).toBeGreaterThan(0)
    expect(screen.getByText('已归档')).toBeTruthy()
    expect(screen.getByRole('button', { name: /收起项目 PipiUI/ })).toBeTruthy()
    await waitFor(() => expect(save).toHaveBeenCalledWith({ pinnedSessionIds: ['welcome'], archivedSessionIds: ['layout'], archivedSessionTimestamps: { layout: expect.any(Number) }, orderedSessionIds: [], sessionOrderVersion: 2 }))
  })

  it('migrates legacy full session order and keeps a new unranked session in the updatedAt top ten', async () => {
    const base = createMockHost()
    const project: Project = { id: 'order', name: 'Order', path: '/tmp/order' }
    const old = Array.from({ length: 11 }, (_, index): Session => ({
      id: `old-${index}`,
      projectId: project.id,
      name: `旧会话 ${index}`,
      updatedAt: 1_000 - index
    }))
    const newest: Session = { id: 'newest', projectId: project.id, name: '最新未手动会话', updatedAt: 2_000 }
    const save = vi.fn(async (preferences: SidebarSessionPreferences) => preferences)
    const host: PipiHostAPI = {
      ...base,
      listProjects: async () => [project],
      listSessions: async () => [newest, ...old],
      getSessionHistory: async () => [],
      getSidebarSessionPreferences: async () => ({
        pinnedSessionIds: [], archivedSessionIds: [], orderedSessionIds: old.map(session => session.id)
      }),
      setSidebarSessionPreferences: save
    }

    render(<App host={host} />)

    const group = await screen.findByRole('group', { name: 'Order 的会话' })
    expect(within(group).getAllByTestId('session-row')[0].getAttribute('data-session-id')).toBe('newest')
    expect(within(group).getByText('最新未手动会话')).toBeTruthy()
    await waitFor(() => expect(save.mock.calls.some(([value]) =>
      value.orderedSessionIds.length === 0 && (value as SidebarSessionPreferences & { sessionOrderVersion?: number }).sessionOrderVersion === 2
    )).toBe(true))
  })

  it('moves a session to the updatedAt front when its run starts', async () => {
    const base = createMockHost()
    const project: Project = { id: 'activity', name: 'Activity', path: '/tmp/activity' }
    const older: Session = { id: 'older', projectId: project.id, name: '刚开始运行', updatedAt: 1_000 }
    const newer: Session = { id: 'newer', projectId: project.id, name: '先前较新', updatedAt: 2_000 }
    let listener: ((event: StreamEvent) => void) | undefined
    const host: PipiHostAPI = {
      ...base,
      listProjects: async () => [project],
      listSessions: async () => [older, newer],
      getSessionHistory: async () => [],
      getSidebarSessionPreferences: async () => ({ pinnedSessionIds: [], archivedSessionIds: [], orderedSessionIds: [], sessionOrderVersion: 2 } as SidebarSessionPreferences),
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } }
    }

    render(<App host={host} />)
    const group = await screen.findByRole('group', { name: 'Activity 的会话' })
    expect(within(group).getAllByTestId('session-row').map(row => row.getAttribute('data-session-id'))).toEqual(['newer', 'older'])

    act(() => listener?.({ type: 'status', sessionId: 'older', status: 'started' }))

    await waitFor(() => expect(within(group).getAllByTestId('session-row').map(row => row.getAttribute('data-session-id'))).toEqual(['older', 'newer']))
  })

  it('persists only sessions involved in an explicit drag and restores that local order', async () => {
    const base = createMockHost()
    const project: Project = { id: 'manual', name: 'Manual', path: '/tmp/manual' }
    const sessions: Session[] = [
      { id: 'a', projectId: project.id, name: 'A', updatedAt: 3_000 },
      { id: 'b', projectId: project.id, name: 'B', updatedAt: 2_000 },
      { id: 'c', projectId: project.id, name: 'C', updatedAt: 1_000 }
    ]
    let durable: SidebarSessionPreferences & { sessionOrderVersion?: 2 } = {
      pinnedSessionIds: [], archivedSessionIds: [], orderedSessionIds: [], sessionOrderVersion: 2
    }
    const save = vi.fn(async (preferences: SidebarSessionPreferences) => {
      durable = { ...preferences }
      return preferences
    })
    const host: PipiHostAPI = {
      ...base,
      listProjects: async () => [project],
      listSessions: async () => sessions,
      getSessionHistory: async () => [],
      getSidebarSessionPreferences: async () => durable,
      setSidebarSessionPreferences: save
    }
    const first = render(<App host={host} />)
    const group = await screen.findByRole('group', { name: 'Manual 的会话' })
    const rows = within(group).getAllByTestId('session-row')
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(rows.find(row => row.getAttribute('data-session-id') === 'c')!, { dataTransfer: transfer })
    const target = rows.find(row => row.getAttribute('data-session-id') === 'a')!
    fireEvent.dragOver(target, { dataTransfer: transfer, clientY: -1 })
    fireEvent.drop(target, { dataTransfer: transfer, clientY: -1 })

    await waitFor(() => expect(within(group).getAllByTestId('session-row').map(row => row.getAttribute('data-session-id'))).toEqual(['a', 'c', 'b']))
    await waitFor(() => expect(save.mock.calls.some(([value]) =>
      value.orderedSessionIds.join(',') === 'a,c' && (value as SidebarSessionPreferences & { sessionOrderVersion?: number }).sessionOrderVersion === 2
    )).toBe(true))
    expect(durable.orderedSessionIds).toEqual(['a', 'c'])
    first.unmount()

    render(<App host={host} />)
    const restored = await screen.findByRole('group', { name: 'Manual 的会话' })
    await waitFor(() => expect(within(restored).getAllByTestId('session-row').map(row => row.getAttribute('data-session-id'))).toEqual(['a', 'c', 'b']))
  })

  it('persists project drag order and routes cross-project session drops through the host', async () => {
    const host = createMockHost()
    const workspace = await host.listProjects()
    host.getProjectPaths = vi.fn(async () => workspace.map(project => project.path))
    const setProjectPaths = vi.fn(async (paths: string[]) => paths)
    host.setProjectPaths = setProjectPaths
    const originalMove = host.moveSession.bind(host)
    const moveSession = vi.fn(originalMove)
    host.moveSession = moveSession
    render(<App host={host} />)
    const projectRows = await screen.findAllByTestId('project-row')
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(projectRows[0], { dataTransfer: transfer })
    fireEvent.dragOver(projectRows[1], { dataTransfer: transfer, clientY: 10 })
    fireEvent.drop(projectRows[1], { dataTransfer: transfer, clientY: 10 })
    await waitFor(() => expect(setProjectPaths).toHaveBeenCalledWith(['/Users/demo/code/website', '/Users/demo/code/pipiui', '/Users/demo/code/design-system']))

    let sessionRow = (await screen.findAllByTestId('session-row')).find(row => row.getAttribute('data-session-id') === 'layout')!
    const pinnedSection = screen.getByLabelText('置顶会话')
    fireEvent.dragStart(sessionRow, { dataTransfer: transfer })
    fireEvent.dragOver(pinnedSection, { dataTransfer: transfer })
    fireEvent.drop(pinnedSection, { dataTransfer: transfer })
    await waitFor(() => expect(screen.getByLabelText('置顶会话').textContent).toContain('布局与流式消息'))

    sessionRow = (await screen.findAllByTestId('session-row')).find(row => row.getAttribute('data-session-id') === 'layout')!
    const websiteRow = (await screen.findAllByTestId('project-row')).find(row => row.getAttribute('data-project-id') === 'website')!
    fireEvent.dragStart(sessionRow, { dataTransfer: transfer })
    fireEvent.dragOver(websiteRow, { dataTransfer: transfer })
    fireEvent.drop(websiteRow, { dataTransfer: transfer })
    await waitFor(() => expect(moveSession).toHaveBeenCalledWith('layout', 'website'))
  })

  it('uses durable explicit project paths for host-backed add/remove, rollback, and remount', async () => {
    const base = createMockHost()
    let durable: Project[] = [
      { id: 'haoli', name: 'haoli', path: '/Users/haoli' },
      { id: 'other', name: 'other', path: '/Users/demo/other' }
    ]
    let removeFails = true
    const getProjectPaths = vi.fn(async () => durable.map(project => project.path))
    const listProjects = vi.fn(async () => durable.map(project => ({ ...project })))
    const listSessions = vi.fn(async (projectId: string) => projectId === 'haoli'
      ? [{ id: 'haoli-session', projectId, name: 'haoli 历史会话', updatedAt: Date.now() }]
      : [{ id: 'other-session', projectId, name: 'other 会话', updatedAt: Date.now() }])
    const addProject = vi.fn(async (path: string) => {
      if (path === '/Users/demo/fail') throw new Error('路径不可用')
      const project = { id: 'added', name: 'added', path }
      durable = [...durable, project]
      return project
    })
    const pickProjectDirectory = vi.fn()
      .mockResolvedValueOnce('/Users/demo/added')
      .mockResolvedValueOnce('/Users/demo/fail')
    const removeProject = vi.fn(async (projectId: string) => {
      if (removeFails) throw new Error('删除被拒绝')
      durable = durable.filter(project => project.id !== projectId)
    })
    const host: PipiHostAPI = { ...base, getProjectPaths, listProjects, listSessions, pickProjectDirectory, addProject, removeProject, getSessionHistory: async () => [] }
    const first = render(<App host={host} />)
    await screen.findByText('haoli')
    await waitFor(() => expect(getProjectPaths).toHaveBeenCalled())

    fireEvent.click(screen.getByLabelText('haoli 项目菜单'))
    fireEvent.click(screen.getByRole('menuitem', { name: '移除项目' }))
    expect(screen.queryByText('haoli')).toBeNull() // optimistic removal
    expect((await screen.findByTestId('sidebar-project-error')).textContent).toContain('删除被拒绝')
    expect(screen.getByText('haoli')).toBeTruthy() // failed removal restores the snapshot
    fireEvent.click(screen.getByLabelText('关闭项目错误'))

    removeFails = false
    fireEvent.click(screen.getByLabelText('haoli 项目菜单'))
    fireEvent.click(screen.getByRole('menuitem', { name: '移除项目' }))
    await waitFor(() => expect(removeProject).toHaveBeenCalledWith('haoli'))
    await waitFor(() => expect(screen.queryByText('haoli')).toBeNull())
    first.unmount()

    render(<App host={host} />)
    await screen.findByText('other')
    await waitFor(() => expect(screen.queryByText('haoli')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(pickProjectDirectory).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(addProject).toHaveBeenCalledWith('/Users/demo/added'))
    expect(await screen.findByText('added')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(pickProjectDirectory).toHaveBeenCalledTimes(2))
    expect((await screen.findByTestId('sidebar-project-error')).textContent).toContain('路径不可用')
    expect(screen.queryByText('fail')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(pickProjectDirectory).toHaveBeenCalledTimes(3))
    expect(addProject).toHaveBeenCalledTimes(2) // cancelling the native picker is a no-op
  })

  it('keeps the composer and SessionStatsPill in the dedicated bottom row for empty, loading, failed history, and an open right rail', async () => {
    const base = createMockHost()
    const project = { id: 'layout-check', name: 'Layout Check', path: '/tmp/layout-check' }
    const session = { id: 'layout-empty', projectId: project.id, name: '空历史会话', updatedAt: Date.now() }
    const histories = [
      async () => [],
      () => new Promise<never>(() => undefined),
      async () => { throw new Error('history unavailable') }
    ]
    for (const getSessionHistory of histories) {
      const { container, unmount } = render(<App host={{ ...base, listProjects: async () => [project], listSessions: async () => [session], getSessionHistory }} />)
      await screen.findAllByText('空历史会话')
      const column = container.querySelector('.chat-column')!
      const viewport = screen.getByTestId('chat-viewport')
      const stack = screen.getByTestId('chat-composer-stack')
      expect(column.children).toHaveLength(3)
      expect(viewport.querySelector('.transcript-area')).toBeTruthy()
      expect(stack.querySelector('.composer')).toBeTruthy()
      expect(within(stack).getByLabelText('消息输入框')).toBeTruthy()
      expect(await within(stack).findByTestId('composer-session-stats')).toBeTruthy()
      unmount()
    }

    const { container } = render(<App host={{ ...base, listProjects: async () => [project], listSessions: async () => [session], getSessionHistory: async () => [] }} />)
    await screen.findAllByText('空历史会话')
    fireEvent.click(screen.getByRole('button', { name: 'Document' }))
    expect(screen.getByRole('button', { name: 'Document' }).className).toContain('active')
    expect(container.querySelector('[data-testid="chat-composer-stack"] .composer')).toBeTruthy()
    expect(container.querySelector('[data-testid="chat-composer-stack"] [data-testid="composer-session-stats"]')).toBeTruthy()
  })

  it('maps stream and session-bound agent snapshots to sidebar statuses without marking unrelated history running', () => {
    const agents: AgentSummary[] = [
      { agentId: 'a-running', runId: '1', name: 'run', task: '', state: 'running', sessionId: 'subtask' },
      { agentId: 'a-failed', runId: '2', name: 'fail', task: '', state: 'failed', sessionId: 'failed' },
      { agentId: 'a-stalled', runId: '3', name: 'stall', task: '', state: 'stalled', sessionId: 'stalled' },
      { agentId: 'a-interrupted', runId: '4', name: 'interrupt', task: '', state: 'interrupted', sessionId: 'interrupted' },
      { agentId: 'a-ok', runId: '5', name: 'ok', task: '', state: 'ok', sessionId: 'completed' }
    ]
    expect(sidebarStatusForSession('selected', 'selected', true, undefined, agents).status).toBe('running')
    expect(sidebarStatusForSession('subtask', 'selected', false, undefined, agents)).toEqual({ status: 'subagents-running', subagentCount: 1 })
    // Stream status is only live for the selected session. A leftover
    // `running` from the last visit must not hide a background subagent badge.
    expect(sidebarStatusForSession('subtask', 'selected', false, 'running', agents)).toEqual({ status: 'subagents-running', subagentCount: 1 })
    expect(sidebarStatusForSession('subtask', 'subtask', false, 'running', agents).status).toBe('running')
    expect(sidebarStatusForSession('idle-running', 'selected', false, 'running', []).status).toBe('running')
    expect(sidebarStatusForSession('failed', 'selected', false, undefined, agents).status).toBe('failed')
    expect(sidebarStatusForSession('stalled', 'selected', false, undefined, agents).status).toBe('stalled')
    expect(sidebarStatusForSession('interrupted', 'selected', false, undefined, agents).status).toBe('interrupted')
    expect(sidebarStatusForSession('completed', 'selected', false, undefined, agents).status).toBe('completed')
    expect(sidebarStatusForSession('unrelated-history', 'selected', false, undefined, agents).status).toBe('idle')
    // Selected session: terminal-status notifications (red dot) are consumed —
    // only running / subagents activity stays visible, everything else goes idle.
    expect(sidebarStatusForSession('failed', 'failed', false, undefined, agents).status).toBe('idle')
    expect(sidebarStatusForSession('stalled', 'stalled', false, undefined, agents).status).toBe('idle')
    expect(sidebarStatusForSession('interrupted', 'interrupted', false, undefined, agents).status).toBe('idle')
    expect(sidebarStatusForSession('completed', 'completed', false, undefined, agents).status).toBe('idle')
    expect(sidebarStatusForSession('subtask', 'subtask', false, undefined, agents)).toEqual({ status: 'subagents-running', subagentCount: 1 })
    expect(sidebarStatusForSession('subtask', 'subtask', true, undefined, agents).status).toBe('running')
  })

  it('maps the session model onto the sidebar logo: own model wins for other sessions, the selected row mirrors the live current model, no model falls back to unknown', () => {
    const current: Model = { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: true }
    const base = { id: 's1', projectId: 'p1', name: 'x', updatedAt: 1 }
    // Non-selected session carries its own model → shown as-is.
    expect(sidebarModelForSession({ ...base, model: { provider: 'openai', modelId: 'gpt-5' } }, 'other', current))
      .toEqual({ provider: 'openai', modelId: 'gpt-5' })
    // Nested model object shape ({ provider, id }) is also accepted (older payload parity).
    expect(sidebarModelForSession({ ...base, model: { provider: 'deepseek', id: 'deepseek-v3' } } as unknown as Session, 'other', current))
      .toEqual({ provider: 'deepseek', modelId: 'deepseek-v3' })
    // No model data → unknown fallback (empty provider renders the neutral logo).
    expect(sidebarModelForSession({ ...base }, 'other', current)).toEqual({ provider: '', modelId: undefined })
    // The selected session mirrors the live composer model state.
    expect(sidebarModelForSession({ ...base }, base.id, current)).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' })
    // A mid-session model switch updates modelState before the session metadata
    // does; the selected row must follow the live state, not the stale metadata.
    expect(sidebarModelForSession({ ...base, model: { provider: 'xai', modelId: 'grok-4' } }, base.id, current))
      .toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' })
    // Without a live model the selected row still falls back to its metadata.
    expect(sidebarModelForSession({ ...base, model: { provider: 'xai', modelId: 'grok-4' } }, base.id, null))
      .toEqual({ provider: 'xai', modelId: 'grok-4' })
    // After a live switch, leaving the session must keep the last-known model —
    // listSessions / JSONL metadata often still has the pre-switch provider.
    expect(sidebarModelForSession(
      { ...base, model: { provider: 'xai', modelId: 'grok-4' } },
      'other',
      current,
      { s1: { provider: 'anthropic', modelId: 'claude-sonnet-4' } }
    )).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4' })
  })

  it('keeps a switched sidebar logo after leaving that session when listSessions metadata lags', async () => {
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      setModel: async (sessionId, provider, id) => {
        const state = await base.setModel(sessionId, provider, id)
        // Real host: setModel updates Pi / in-memory snapshots, but the React
        // sessions[] copy from the last listSessions still has the old model.
        const listed = await base.listSessions('pipiui')
        const welcome = listed.find(session => session.id === 'welcome')
        if (welcome) welcome.model = { provider: 'anthropic', modelId: 'claude-sonnet-4' }
        return state
      }
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const welcome = () => container.querySelector('[data-session-id="welcome"]')!
    expect(welcome().querySelector('[data-testid="provider-logo-anthropic"]')).toBeTruthy()

    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-gpt-5'))
    await waitFor(() => expect(welcome().querySelector('[data-testid="provider-logo-openai"]')).toBeTruthy())

    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('aria-current')).toBe('true'))
    expect(welcome().querySelector('[data-testid="provider-logo-openai"]')).toBeTruthy()
    expect(welcome().querySelector('[data-testid="provider-logo-anthropic"]')).toBeNull()
    expect(container.querySelector('[data-session-id="layout"] [data-testid="provider-logo-openai"]')).toBeTruthy()
  })

  it('does not replace a live running agent with a later empty listAgents snapshot', () => {
    const running: AgentSummary = { agentId: 'bg', runId: '1', name: 'explore', task: '', state: 'running', sessionId: 'layout' }
    expect(mergeAgentSnapshot([running], [])).toEqual([running])
    expect(mergeAgentSummary([], { ...running, sessionId: undefined }).map(agent => agent.sessionId)).toEqual([undefined])
    expect(mergeAgentSummary([running], { ...running, sessionId: undefined, state: 'running' })[0]?.sessionId).toBe('layout')
  })

  it('keeps a background subagent-running badge when a later listAgents snapshot is empty', async () => {
    const base = createMockHost()
    let resolveList: ((agents: AgentSummary[]) => void) | undefined
    const agentListeners = new Set<(event: AgentEvent) => void>()
    const host: PipiHostAPI = {
      ...base,
      listAgents: () => new Promise(resolve => { resolveList = resolve }),
      subscribeAgents: listener => {
        agentListeners.add(listener)
        return () => { agentListeners.delete(listener) }
      }
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    act(() => {
      const event: AgentEvent = { type: 'agent', agent: { agentId: 'bg', runId: '1', sessionId: 'layout', name: 'explore', task: '', state: 'running' } }
      for (const listener of agentListeners) listener(event)
    })
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('subagents-running'))
    act(() => resolveList?.([]))
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')?.getAttribute('data-status')).toBe('subagents-running'))
  })

  it('shows return-to-latest after leaving the bottom and rail jumps with Virtuoso', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    virtuosoHarness.atBottom?.(false)
    await screen.findByRole('button', { name: '回到最新' })
    fireEvent.click(screen.getByRole('button', { name: '回到最新' }))
    expect(virtuosoHarness.scrollToIndex).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '用户输入 1/1' }))
    expect(virtuosoHarness.scrollToIndex).toHaveBeenCalled()
  })

  it('uses a disclosure for completed steps but not for the active ordinary tool', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-testid="subagent-transcript"] [data-testid="assistant-transcript-content"]')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '开始流式测试' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    const summary = await screen.findByRole('button', { name: /个步骤/ })
    expect(summary.closest('[data-activity-card="default"]')).toBeTruthy()
    const activeTool = screen.getByTestId('active-tool')
    expect(activeTool.textContent).toContain('read · Electron/packages/ui/package.json')
    expect(activeTool.querySelector('[aria-expanded]')).toBeNull()
    expect(activeTool.querySelector('.activity-details')).toBeNull()
    expect(activeTool.querySelector('.tool-io')).toBeNull()
    fireEvent.click(summary)
    // Collapsing prior steps does not hide or mutate the independent active tool row.
    expect(screen.getByTestId('active-tool')).toBeTruthy()
  })

  it('renders structured 子任务 cards for matching tool notices and falls back otherwise', async () => {
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async sessionId => sessionId === 'welcome' ? [
        { id: 't1', role: 'tool', content: '子任务完成 · explore · ok · cost ¥0.12', timestamp: Date.now() },
        { id: 't2', role: 'tool', content: '已读取 package.json', timestamp: Date.now() }
      ] : []
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-activity-card="result"]')).toBeTruthy())
    const noticeCard = container.querySelector('[data-activity-card="result"]')!
    expect(noticeCard).toBeTruthy()
    expect(noticeCard.textContent).toContain('子任务')
    expect(noticeCard.textContent).toContain('成功 · ¥0.12')
    expect(noticeCard.querySelector('pre')).toBeNull()
    fireEvent.click(noticeCard.querySelector('.activity-summary')!)
    expect(noticeCard.querySelector('pre')?.textContent).toContain('子任务完成 · explore · ok · cost ¥0.12')
    const fallback = container.querySelector('.system-message')
    expect(fallback?.textContent).toContain('已读取 package.json')
    expect(container.querySelectorAll('[data-activity-card="result"]').length).toBe(1)
  })

  it('keeps Thinking collapsed by default and expands it on demand', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '思考一下' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    // Wait for the turn to settle — the outer step card remounts collapsed.
    await waitFor(() => expect(screen.getByRole('button', { name: /个步骤/ }).getAttribute('aria-expanded')).toBe('false'))
    const outer = screen.getByRole('button', { name: /个步骤/ })
    fireEvent.click(outer)
    // Thinking is collapsed by default inside the expanded step card.
    const thinkingButton = await screen.findByRole('button', { name: /^Thinking/ })
    expect(thinkingButton.closest('[data-activity-card="thinking"]')).toBeTruthy()
    expect(thinkingButton.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(thinkingButton)
    await screen.findByText(/正在分析请求与当前项目结构/)
  })

  it('appends mock streaming events to the transcript', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '开始流式测试' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(screen.getByRole('button', { name: /个步骤/ })).toBeTruthy())
    await waitFor(() => expect(screen.getByText(/已开始处理/)).toBeTruthy())
  })

  it('keeps idle submits direct and routes busy composer submits through enqueueMessage', async () => {
    const base = createMockHost()
    const sendPrompt = vi.fn(async () => undefined)
    const enqueueMessage = vi.fn(async (sessionId: string, text: string) => ({ outcome: 'queued' as const, message: queuedMessage('busy-item', sessionId, text) }))
    const host: PipiHostAPI = { ...base, sendPrompt, enqueueMessage, listQueue: async () => [] }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    const composer = screen.getByLabelText('消息输入框')
    fireEvent.change(composer, { target: { value: 'idle direct' } })
    await waitFor(() => expect((screen.getByLabelText('发送消息') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', 'idle direct'))
    expect(enqueueMessage).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: 'busy queue' } })
    await waitFor(() => expect(screen.getByLabelText('加入消息队列')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('加入消息队列'))
    await waitFor(() => expect(enqueueMessage).toHaveBeenCalledWith('welcome', 'busy queue', undefined))
    expect(sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('consumes queue_update snapshots only for the selected session and retains attachment/status metadata', async () => {
    const base = createMockHost()
    const listeners = new Map<string, (event: StreamEvent) => void>()
    const host: PipiHostAPI = {
      ...base,
      listQueue: async () => [],
      subscribeStream: (sessionId, listener) => { listeners.set(sessionId, listener); return () => { if (listeners.get(sessionId) === listener) listeners.delete(sessionId) } }
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listeners.has('welcome')).toBe(true))
    const staleWelcomeListener = listeners.get('welcome')!
    const welcomeQueue = [
      queuedMessage('welcome-queued', 'welcome', '带附件的排队消息', 'queued', [{ dataBase64: 'aGVsbG8=', mimeType: 'image/png', name: 'queue.png' }]),
      queuedMessage('welcome-sending', 'welcome', '正在发送', 'sending'),
      queuedMessage('welcome-failed', 'welcome', '失败消息', 'failed', [], '上游超时')
    ]
    await act(async () => { staleWelcomeListener({ type: 'queue_update', sessionId: 'welcome', queue: welcomeQueue }) })
    expect(await screen.findByTestId('message-queue')).toBeTruthy()
    fireEvent.click(screen.getByTestId('message-queue-toggle'))
    expect(screen.getByTestId('queue-thumbs-0').textContent).toContain('1')
    expect(screen.getByTestId('queue-status-1').textContent).toBe('发送中')
    expect(screen.getByTestId('queue-error-2').textContent).toBe('上游超时')

    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listeners.has('layout')).toBe(true))
    await waitFor(() => expect(screen.queryByTestId('message-queue')).toBeNull())
    // A callback captured before unsubscription must not bleed welcome's queue into layout.
    await act(async () => { staleWelcomeListener({ type: 'queue_update', sessionId: 'welcome', queue: welcomeQueue }) })
    expect(screen.queryByTestId('message-queue')).toBeNull()

    await act(async () => { listeners.get('layout')!({ type: 'queue_update', sessionId: 'layout', queue: [queuedMessage('layout-queued', 'layout', '只属于布局会话')] }) })
    expect((await screen.findByTestId('message-queue')).textContent).toContain('只属于布局会话')
  })

  it('wires edit/remove/retry and immediate dispatch to their supported queue host APIs', async () => {
    const base = createMockHost()
    const queue = [
      queuedMessage('editable', 'welcome', '待编辑', 'queued', [{ dataBase64: 'aGVsbG8=', mimeType: 'image/png', name: 'keep.png' }]),
      queuedMessage('failed', 'welcome', '待重试', 'failed', [], '网络错误')
    ]
    let listener: ((event: StreamEvent) => void) | undefined
    const updateQueuedMessage = vi.fn(async (_sessionId: string, messageId: string, text: string, attachments?: PromptAttachment[]) => ({ ...queue.find(item => item.id === messageId)!, text, attachments: attachments ?? [] }))
    const removeQueuedMessage = vi.fn(async (_sessionId: string, messageId: string) => queue.find(item => item.id === messageId)!)
    const retryQueuedMessage = vi.fn(async (_sessionId: string, messageId: string) => ({ ...queue.find(item => item.id === messageId)!, state: 'queued' as const, error: undefined }))
    const steerQueuedMessage = vi.fn(async (_sessionId: string, messageId: string) => ({ ...queue.find(item => item.id === messageId)!, state: 'sending' as const }))
    const host: PipiHostAPI = {
      ...base,
      listQueue: async sessionId => sessionId === 'welcome' ? queue : [],
      updateQueuedMessage,
      removeQueuedMessage,
      retryQueuedMessage,
      steerQueuedMessage,
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } }
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await screen.findByTestId('message-queue')
    fireEvent.click(screen.getByTestId('message-queue-toggle'))

    fireEvent.click(screen.getByTestId('queue-edit-0'))
    fireEvent.change(screen.getByTestId('queue-editor-input-0'), { target: { value: '已编辑' } })
    fireEvent.click(screen.getByTestId('queue-save'))
    await waitFor(() => expect(updateQueuedMessage).toHaveBeenCalledWith('welcome', 'editable', '已编辑', [expect.objectContaining({ name: 'keep.png' })]))

    fireEvent.click(screen.getByTestId('queue-remove-0'))
    await waitFor(() => expect(removeQueuedMessage).toHaveBeenCalledWith('welcome', 'editable'))
    fireEvent.click(screen.getByTestId('queue-retry-1'))
    await waitFor(() => expect(retryQueuedMessage).toHaveBeenCalledWith('welcome', 'failed'))

    await act(async () => { listener?.({ type: 'status', sessionId: 'welcome', status: 'started' }) })
    expect(await screen.findByTestId('queue-steer-0')).toBeTruthy()
    fireEvent.click(screen.getByTestId('queue-steer-0'))
    await waitFor(() => expect(steerQueuedMessage).toHaveBeenCalledWith('welcome', 'editable'))
  })
})

function queuedMessage(id: string, sessionId: string, text: string, state: QueuedMessage['state'] = 'queued', attachments: PromptAttachment[] = [], error?: string): QueuedMessage {
  return { id, sessionId, text, attachments, createdAt: 1, state, error }
}

async function renderChat(host: PipiHostAPI) {
  render(<App host={host} />)
  await screen.findAllByText('Electron 三栏界面')
  return screen.getByLabelText('消息输入框') as HTMLTextAreaElement
}

/** Works both when vitest runs from packages/ui and from the workspace root. */
function readAppCss(): string {
  const candidates = [join('src', 'app.css'), join('packages', 'ui', 'src', 'app.css')]
  const found = candidates.map(candidate => join(process.cwd(), candidate)).find(existsSync)
  if (!found) throw new Error('cannot locate app.css for the sizing assertion')
  return readFileSync(found, 'utf8')
}

const objectUrlIds = { next: 0 }
const revokedUrls: string[] = []

beforeAll(() => {
  URL.createObjectURL = vi.fn((obj: Blob | MediaSource) => `blob:mock-${objectUrlIds.next++}`) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn((url: string) => { revokedUrls.push(String(url)) }) as unknown as typeof URL.revokeObjectURL
})
beforeEach(() => {
  objectUrlIds.next = 0
  revokedUrls.length = 0
})

function makeImageFile(name = 'shot.png', type = 'image/png', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type })
}

function pasteImage(textarea: HTMLTextAreaElement, file: File) {
  fireEvent.paste(textarea, {
    clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] }
  })
}

async function openModelModal(host: PipiHostAPI): Promise<HTMLTextAreaElement> {
  const composer = await renderChat(host)
  fireEvent.change(composer, { target: { value: '/model' } })
  fireEvent.keyDown(composer, { key: 'Enter' })
  await screen.findByTestId('model-modal')
  return composer
}

async function reopenModelModal(composer: HTMLTextAreaElement) {
  fireEvent.change(composer, { target: { value: '/model' } })
  fireEvent.keyDown(composer, { key: 'Enter' })
  await screen.findByTestId('model-modal')
}

describe('session switch transcript cache', () => {
  it('keeps a visited session transcript on screen when switching away and back', async () => {
    const base = createMockHost()
    let welcomeLoads = 0
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async sessionId => {
        if (sessionId === 'welcome') {
          welcomeLoads += 1
          if (welcomeLoads > 1) return new Promise(() => undefined)
        }
        return base.getSessionHistory(sessionId)
      }
    }
    const { container } = render(<App host={host} />)
    await screen.findByText('请实现 Electron 三栏主界面。')
    expect(welcomeLoads).toBe(1)

    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await screen.findByText('左栏宽度要能持久化。')
    const welcomeTranscript = screen.getByText('请实现 Electron 三栏主界面。').closest('[data-session-transcript]') as HTMLElement | null
    const layoutTranscript = screen.getByText('左栏宽度要能持久化。').closest('[data-session-transcript]') as HTMLElement | null
    expect(welcomeTranscript?.getAttribute('data-session-transcript')).toBe('welcome')
    expect(welcomeTranscript?.hidden).toBe(true)
    expect(layoutTranscript?.hidden).toBe(false)

    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    expect(welcomeTranscript?.hidden).toBe(false)
    expect(layoutTranscript?.hidden).toBe(true)
    expect(welcomeLoads).toBe(1)
  })

  it('does not refetch history when opening a new empty session', async () => {
    const base = createMockHost()
    const getSessionHistory = vi.fn(base.getSessionHistory)
    const host: PipiHostAPI = { ...base, getSessionHistory }
    render(<App host={host} />)
    await screen.findByText('请实现 Electron 三栏主界面。')
    const loadsBeforeNew = getSessionHistory.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /在 PipiUI 新建会话/ }))
    await waitFor(() => expect(screen.getByLabelText('消息输入框')).toBeTruthy())
    expect((screen.getByText('请实现 Electron 三栏主界面。').closest('[data-session-transcript]') as HTMLElement | null)?.hidden).toBe(true)
    expect(getSessionHistory.mock.calls.length).toBe(loadsBeforeNew)
  })
})

describe('composer draft persistence', () => {
  it('restores unsent composer text when returning to a session', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const box = () => screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(box(), { target: { value: 'welcome-draft-keep' } })
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    expect(box().value).not.toBe('welcome-draft-keep')
    fireEvent.change(box(), { target: { value: 'layout-draft-keep' } })
    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    expect(box().value).toBe('welcome-draft-keep')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    expect(box().value).toBe('layout-draft-keep')
  })

  it('does not restore composer text after a successful send', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const box = () => screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(box(), { target: { value: 'sent-then-gone' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(box().value).toBe(''))
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    expect(box().value).toBe('')
  })

  it('clears the composer as soon as send starts, not after sendPrompt resolves', async () => {
    const base = createMockHost()
    let release!: () => void
    const sendPrompt = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const host: PipiHostAPI = { ...base, sendPrompt }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const box = () => screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(box(), { target: { value: '发送后应立刻消失' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(box().value).toBe(''))
    expect(screen.getByText('发送后应立刻消失')).toBeTruthy()
    expect(sendPrompt).toHaveBeenCalled()
    await act(async () => { release() })
    expect(box().value).toBe('')
  })
})

describe('composer slash commands and model management', () => {
  it('shows the slash menu on /, ranks /model, and has an empty state', async () => {
    await renderChat(createMockHost())
    const composer = screen.getByLabelText('消息输入框')
    fireEvent.change(composer, { target: { value: '/m' } })
    const row = await screen.findByTestId('slash-row-model')
    expect(row.textContent).toContain('/model')
    expect(row.textContent).toContain('管理模型可见性')
    expect(row.getAttribute('aria-selected')).toBe('true')
    fireEvent.change(composer, { target: { value: '/zzz' } })
    expect(screen.getByTestId('slash-empty')).toBeTruthy()
    expect(screen.queryByTestId('slash-row-model')).toBeNull()
  })

  it('opens the model management modal on Enter for /model without sending a prompt', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    await openModelModal(host)
    expect(sendPrompt).not.toHaveBeenCalled()
    // Swift executeSlash clears the draft before running the command
    expect((screen.getByLabelText('消息输入框') as HTMLTextAreaElement).value).toBe('')
  })

  it('opens the model management modal from the pinned sidebar settings footer', async () => {
    await renderChat(createMockHost())
    const gear = screen.getByRole('button', { name: '设置' })
    fireEvent.click(gear)
    await screen.findByTestId('model-modal')
    // The sidebar footer stays pinned: closing keeps the gear reachable.
    fireEvent.mouseDown(document.querySelector('.model-modal-backdrop')!)
    expect(screen.queryByTestId('model-modal')).toBeNull()
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
  })

  it('handles /model with trailing text via Enter without sending a prompt', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model ' } })
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(await screen.findByTestId('model-modal')).toBeTruthy()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('opens the model management modal when clicking the /model candidate without sending', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    await renderChat(host)
    fireEvent.change(screen.getByLabelText('消息输入框'), { target: { value: '/' } })
    fireEvent.mouseDown(await screen.findByTestId('slash-row-model'))
    expect(await screen.findByTestId('model-modal')).toBeTruthy()
    expect(sendPrompt).not.toHaveBeenCalled()
  })

  it('navigates the slash menu with arrows, completes with Tab, dismisses with Esc', async () => {
    const composer = await renderChat(createMockHost())
    fireEvent.change(composer, { target: { value: '/m' } })
    expect((await screen.findByTestId('slash-row-model')).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(composer, { key: 'ArrowDown' })
    fireEvent.keyDown(composer, { key: 'ArrowUp' })
    expect(screen.getByTestId('slash-row-model').getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(composer, { key: 'Tab' })
    expect(composer.value).toBe('/model ')
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    fireEvent.change(composer, { target: { value: '/mod' } })
    expect(screen.getByTestId('slash-menu')).toBeTruthy()
    fireEvent.keyDown(composer, { key: 'Escape' })
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    expect(composer.value).toBe('/mod')
    fireEvent.change(composer, { target: { value: '/model' } })
    expect(screen.getByTestId('slash-menu')).toBeTruthy()
  })

  it('closes the slash menu when clicking outside', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const composer = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '/' } })
    await screen.findByTestId('slash-menu')
    fireEvent.mouseDown(container.querySelector('.slash-backdrop')!)
    expect(screen.queryByTestId('slash-menu')).toBeNull()
    expect(composer.value).toBe('/')
  })

  it('groups models by provider and collapses/expands provider sections within the modal lifetime', async () => {
    await openModelModal(createMockHost())
    const provider = await screen.findByTestId('model-provider-anthropic')
    // every provider starts collapsed by default
    expect(provider.querySelectorAll('.model-row').length).toBe(0)
    expect(screen.getByTestId('model-provider-openai')).toBeTruthy()
    expect(screen.getByTestId('model-provider-deepseek')).toBeTruthy()
    const anthropicToggle = screen.getByLabelText('展开 anthropic')
    expect(anthropicToggle.getAttribute('aria-expanded')).toBe('false')
    // expanding reveals the provider's rows
    fireEvent.click(anthropicToggle)
    expect(provider.querySelectorAll('.model-row').length).toBe(2)
    expect(anthropicToggle.getAttribute('aria-expanded')).toBe('true')
    // collapse keeps rows hidden until expanded again (modal-lifetime state)
    fireEvent.click(screen.getByLabelText('折叠 anthropic'))
    expect(screen.queryByTestId('model-row-anthropic-claude-sonnet-4')).toBeNull()
    fireEvent.click(screen.getByLabelText('展开 anthropic'))
    expect(await screen.findByTestId('model-row-anthropic-claude-sonnet-4')).toBeTruthy()
  })

  it('refreshes the catalog from the header refresh button', async () => {
    const host = createMockHost()
    const listModels = vi.spyOn(host, 'listModels')
    await openModelModal(host)
    const button = await screen.findByTestId('model-refresh-button') as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(button.textContent).toContain('刷新')
    const callsBefore = listModels.mock.calls.length
    expect(callsBefore).toBeGreaterThan(0)
    fireEvent.click(button)
    await waitFor(() => expect(listModels.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('refresh keeps expanded providers expanded and new providers collapsed by default', async () => {
    const host = createMockHost()
    const base = host.listModels
    let withExtra = false
    host.listModels = vi.fn(async () => {
      const models = await base()
      return withExtra ? [...models, { provider: 'mistral', id: 'mistral-large', name: 'Mistral Large', reasoning: true }] : models
    })
    await openModelModal(host)
    fireEvent.click(screen.getByLabelText('展开 anthropic'))
    await screen.findByTestId('model-row-anthropic-claude-sonnet-4')
    withExtra = true
    fireEvent.click(screen.getByTestId('model-refresh-button'))
    await waitFor(() => expect(screen.getByTestId('model-provider-mistral')).toBeTruthy())
    // the new provider appears collapsed by default
    expect(screen.getByLabelText('展开 mistral').getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('model-row-mistral-mistral-large')).toBeNull()
    // the previously expanded provider stays expanded after refresh
    expect(await screen.findByTestId('model-row-anthropic-claude-sonnet-4')).toBeTruthy()
  })

  it('persists checkbox state through the host and re-reads it on reopen', async () => {
    const host = createMockHost()
    const setHidden = vi.spyOn(host, 'setHiddenModelIds')
    const composer = await openModelModal(host)
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 GPT-5'))
    await waitFor(() => expect(setHidden).toHaveBeenCalledWith(['openai/gpt-5']))
    expect(await host.getHiddenModelIds()).toEqual(['openai/gpt-5'])
    // close and reopen — the host is the source of truth
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('model-modal')).toBeNull()
    await reopenModelModal(composer)
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(false)
  })

  it('clears every model of a provider through the tri-state checkbox (hide all)', async () => {
    const host = createMockHost()
    const setHidden = vi.spyOn(host, 'setHiddenModelIds')
    await openModelModal(host)
    fireEvent.click(screen.getByLabelText('展开 deepseek'))
    await screen.findByTestId('model-provider-deepseek')
    const check = screen.getByLabelText('deepseek 全部勾选') as HTMLInputElement
    expect(check.checked).toBe(true)
    fireEvent.click(check)
    await waitFor(() => expect(setHidden).toHaveBeenCalledWith(['deepseek/deepseek-v3']))
    expect((screen.getByLabelText('在快捷菜单显示 DeepSeek V3') as HTMLInputElement).checked).toBe(false)
  })

  it('keeps the current model visible in the quick menu even when unchecked (Swift fallback)', async () => {
    const host = createMockHost()
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    fireEvent.click(screen.getByLabelText('展开 anthropic'))
    await screen.findByTestId('model-row-anthropic-claude-sonnet-4')
    expect((screen.getByLabelText('在快捷菜单显示 Claude Sonnet 4') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('当前模型')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 Claude Sonnet 4'))
    await waitFor(async () => expect(await host.getHiddenModelIds()).toContain('anthropic/claude-sonnet-4'))
    fireEvent.keyDown(window, { key: 'Escape' })
    // unchecked current model is still listed (保底可见) and marked current
    fireEvent.click(await screen.findByTestId('model-chip'))
    const row = await screen.findByTestId('quick-row-anthropic-claude-sonnet-4')
    expect(row.className).toContain('current')
    expect(row.textContent).toContain('✓')
  })

  it('renders provider logo tiles with brand mapping and a unified fallback for unknown providers', async () => {
    await openModelModal(createMockHost())
    await screen.findByTestId('model-provider-anthropic')
    expect(screen.getAllByTestId('provider-logo-anthropic').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-openai').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-deepseek').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-kimi').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-xai').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-zhipu').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-volcengine').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-qwen').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('provider-logo-unknown').length).toBeGreaterThan(0)
  })

  it('closes the model management modal with Escape or the backdrop', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const composer = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    fireEvent.mouseDown(container.querySelector('.model-modal-backdrop')!)
    expect(screen.queryByTestId('model-modal')).toBeNull()
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('model-modal')).toBeNull()
  })
})

describe('composer quick model menu', () => {
  it('renders the selected session confirmed model instead of the configured default', async () => {
    const configured: ModelState = { model: { provider: 'volcengine', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: true }, thinkingLevel: 'high', availableThinkingLevels: ['off', 'high'] }
    const active: ModelState = { model: { provider: 'openai-codex', id: 'gpt-5.5', name: 'GPT-5.5', reasoning: true }, thinkingLevel: 'high', availableThinkingLevels: ['off', 'high'] }
    const getModelState = vi.fn(async (sessionId?: string) => sessionId ? active : configured)
    const host = { ...createMockHost(), getModelState } as PipiHostAPI
    const { container } = render(<App host={host} />)
    await waitFor(() => expect(getModelState).toHaveBeenCalledWith('welcome'))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5.5'))
    // the header no longer shows the model name (only the title)
    await waitFor(() => expect(container.querySelector('.model-detail')).toBeNull())
  })

  it('shows logo + display name only (no full provider/id) and lists only checked models', async () => {
    const host = createMockHost()
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 GPT-5'))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(await screen.findByTestId('model-chip'))
    await screen.findByTestId('quick-menu')
    expect(screen.queryByTestId('quick-row-openai-gpt-5')).toBeNull()
    expect(await screen.findByTestId('quick-row-anthropic-claude-sonnet-4')).toBeTruthy()
    // no full provider/id refs rendered inside the quick menu
    const menu = screen.getByTestId('quick-menu')
    expect(menu.textContent).not.toContain('anthropic/claude-sonnet-4')
    expect(menu.textContent).not.toContain('openai/gpt-5')
    // provider titles present (low contrast), no search box
    expect(screen.getAllByText('anthropic').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText('搜索模型')).toBeNull()
    const current = screen.getByTestId('quick-row-anthropic-claude-sonnet-4')
    expect(current.className).toContain('current')
    expect(current.textContent).toContain('✓')
    expect(current.textContent).toContain('Claude Sonnet 4')
  })

  it('updates the model chip before setModel resolves', async () => {
    const base = createMockHost()
    let release: ((state: ModelState) => void) | undefined
    const host: PipiHostAPI = {
      ...base,
      setModel: () => new Promise(resolve => { release = resolve })
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-gpt-5'))
    expect(screen.queryByTestId('quick-menu')).toBeNull()
    expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5')
    release?.(await base.setModel('welcome', 'openai', 'gpt-5'))
  })

  it('does not revert the chip when a late getModelState arrives after a switch', async () => {
    const base = createMockHost()
    const stale = await base.getModelState('welcome')
    expect(stale.model.id).toBe('claude-sonnet-4')
    const pending: Array<(state: ModelState) => void> = []
    const host: PipiHostAPI = {
      ...base,
      getModelState: () => new Promise(resolve => { pending.push(resolve) })
    }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-gpt-5'))
    expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5')
    await act(async () => { for (const resolve of pending) resolve(stale) })
    expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5')
  })

  it('switches the model from the quick menu, closes the menu, and updates the chip', async () => {
    const host = createMockHost()
    const setModel = vi.spyOn(host, 'setModel')
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-gpt-5'))
    await waitFor(() => expect(setModel).toHaveBeenCalledWith('welcome', 'openai', 'gpt-5'))
    await waitFor(() => expect(screen.queryByTestId('quick-menu')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5'))
    await waitFor(() => expect(container.querySelector('.model-detail')).toBeNull())
  })

  it('shows a lightweight error and keeps the original model on failed switch', async () => {
    const host = { ...createMockHost(), setModel: vi.fn(async () => { throw new Error('模型不可用') }) }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-gpt-5'))
    expect(await screen.findByText(/切换模型失败：模型不可用/)).toBeTruthy()
    expect(screen.getByTestId('model-chip').textContent).toContain('Claude Sonnet 4')
    expect(container.querySelector('.model-detail')).toBeNull()
  })
})

describe('demo mock host model persistence (browser reload)', () => {
  it('restores the persisted demo model from localStorage on host creation', async () => {
    localStorage.setItem('pipiui.demoModel', JSON.stringify({ provider: 'openai', id: 'openai-codex' }))
    const state = await createMockHost().getModelState()
    expect(state.model.provider).toBe('openai')
    expect(state.model.id).toBe('openai-codex')
    expect(state.model.name).toBe('OpenAI Codex')
  })

  it('derives thinking levels from the restored model', async () => {
    localStorage.setItem('pipiui.demoModel', JSON.stringify({ provider: 'deepseek', id: 'deepseek-v3' }))
    const state = await createMockHost().getModelState()
    expect(state.model.id).toBe('deepseek-v3')
    expect(state.availableThinkingLevels).toEqual([])
  })

  it('writes the selected model to localStorage on switch', async () => {
    const host = createMockHost()
    await host.setModel('welcome', 'openai', 'openai-codex')
    expect(JSON.parse(localStorage.getItem('pipiui.demoModel')!)).toEqual({ provider: 'openai', id: 'openai-codex' })
  })

  it('restores the switched model on a fresh host instance (simulated reload)', async () => {
    await createMockHost().setModel('welcome', 'openai', 'openai-codex')
    const reloaded = await createMockHost().getModelState()
    expect(reloaded.model.id).toBe('openai-codex')
  })

  it('falls back to the default model when nothing is stored', async () => {
    expect(localStorage.getItem('pipiui.demoModel')).toBeNull()
    const state = await createMockHost().getModelState()
    expect(state.model.id).toBe('claude-sonnet-4')
    expect(state.model.name).toBe('Claude Sonnet 4')
  })

  it('falls back to the default model when the stored value is invalid', async () => {
    // malformed JSON
    localStorage.setItem('pipiui.demoModel', 'not-json{')
    expect((await createMockHost().getModelState()).model.id).toBe('claude-sonnet-4')
    // incomplete shape (no id)
    localStorage.setItem('pipiui.demoModel', JSON.stringify({ provider: 'openai' }))
    expect((await createMockHost().getModelState()).model.id).toBe('claude-sonnet-4')
    // non-object value
    localStorage.setItem('pipiui.demoModel', JSON.stringify('openai/gpt-5'))
    expect((await createMockHost().getModelState()).model.id).toBe('claude-sonnet-4')
  })

  it('falls back to the default model when the stored model is no longer in the catalog', async () => {
    localStorage.setItem('pipiui.demoModel', JSON.stringify({ provider: 'openai', id: 'gpt-4-legacy' }))
    const state = await createMockHost().getModelState()
    expect(state.model.id).toBe('claude-sonnet-4')
  })

  it('binds model and context per session: switching sessions changes both, switching a model only changes that session, and per-session models survive a reload', async () => {
    localStorage.removeItem(DEMO_MODEL_STORAGE_KEY)
    localStorage.removeItem(DEMO_SESSION_MODELS_STORAGE_KEY)
    try {
      const host = createMockHost()
      expect((await host.getModelState('welcome')).model.id).toBe('claude-sonnet-4')
      expect((await host.getModelState('layout')).model.id).toBe('gpt-5')
      expect((await host.getModelState('agent-run')).model.id).toBe('deepseek-v3')
      // Context occupancy differs per session (fixture ring/window).
      const welcome = await host.getSessionStats('welcome')
      const layout = await host.getSessionStats('layout')
      expect(welcome.contextUsage?.tokens).toBe(76_000)
      expect(layout.contextUsage?.tokens).toBe(40_000)
      expect(welcome.contextUsage?.contextWindow).not.toBe(layout.contextUsage?.contextWindow)
      // Switching a model is session-scoped: the other session keeps its own.
      await host.setModel('welcome', 'deepseek', 'deepseek-v3')
      expect((await host.getModelState('welcome')).model.id).toBe('deepseek-v3')
      expect((await host.getModelState('layout')).model.id).toBe('gpt-5')
      // Per-session model survives a simulated reload.
      const reloaded = createMockHost()
      expect((await reloaded.getModelState('welcome')).model.id).toBe('deepseek-v3')
      expect((await reloaded.getModelState('layout')).model.id).toBe('gpt-5')
    } finally {
      localStorage.removeItem(DEMO_MODEL_STORAGE_KEY)
      localStorage.removeItem(DEMO_SESSION_MODELS_STORAGE_KEY)
    }
  })

  it('switching sessions in the demo UI moves the model chip and the context ring', async () => {
    localStorage.removeItem(DEMO_MODEL_STORAGE_KEY)
    localStorage.removeItem(DEMO_SESSION_MODELS_STORAGE_KEY)
    try {
      const { container } = render(<App host={createMockHost()} />)
      await screen.findAllByText('Electron 三栏界面')
      // Welcome is the initially selected session → Claude Sonnet 4 + 76k/200k.
      await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('Claude Sonnet 4'))
      await waitFor(() => expect(screen.getByTestId('stats-pill').textContent).toContain('76k/200k'))
      // Switching to the layout session binds its own model and context.
      fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
      await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5'))
      await waitFor(() => expect(screen.getByTestId('stats-pill').textContent).toContain('40k/128k'))
      // And back — the welcome session keeps its own values.
      fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
      await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('Claude Sonnet 4'))
      await waitFor(() => expect(screen.getByTestId('stats-pill').textContent).toContain('76k/200k'))
    } finally {
      localStorage.removeItem(DEMO_MODEL_STORAGE_KEY)
      localStorage.removeItem(DEMO_SESSION_MODELS_STORAGE_KEY)
    }
  })

  it('shows the target session model immediately while its authoritative refresh is still pending', async () => {
    const base = createMockHost()
    let resolveLayout: ((state: ModelState) => void) | undefined
    const getModelState = vi.fn(async (sessionId?: string) => {
      if (sessionId !== 'layout') return base.getModelState(sessionId)
      return new Promise<ModelState>(resolve => { resolveLayout = resolve })
    })
    const host: PipiHostAPI = { ...base, getModelState }
    const { container } = render(<App host={host} />)

    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('Claude Sonnet 4'))
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)

    // listSessions already carries layout's openai/gpt-5 binding. A slow Pi
    // refresh must never leave the previous session's Claude model visible.
    expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5')
    expect(screen.getByTestId('model-chip').textContent).not.toContain('Claude')

    resolveLayout?.(await base.getModelState('layout'))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5'))
  })
})

describe('composer image attachments', () => {
  it('has no attach button or file picker — images arrive only via clipboard paste', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(screen.queryByLabelText('添加图片')).toBeNull()
    expect(container.querySelector('.composer')?.textContent).not.toContain('＋')
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect((createMockHost() as { pickImages?: unknown }).pickImages).toBeUndefined()
  })

  it('adds pasted clipboard images as attachments', async () => {
    await renderChat(createMockHost())
    pasteImage(screen.getByLabelText('消息输入框') as HTMLTextAreaElement, makeImageFile('pasted.png'))
    const thumb = await screen.findByTestId('composer-thumb-0')
    expect(thumb.querySelector('img')?.getAttribute('alt')).toBe('pasted.png')
  })

  it('supports multiple images, removal (with revoke), and unmount revoke', async () => {
    const { unmount } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    pasteImage(textarea, makeImageFile('a.png'))
    await screen.findByTestId('composer-thumb-0')
    pasteImage(textarea, makeImageFile('b.png'))
    await screen.findByTestId('composer-thumb-1')
    expect(screen.getAllByTestId(/composer-thumb-/).length).toBe(2)
    fireEvent.click(screen.getByLabelText('移除图片 a.png'))
    await waitFor(() => expect(screen.getAllByTestId(/composer-thumb-/).length).toBe(1))
    expect(revokedUrls).toContain('blob:mock-0')
    unmount()
    expect(revokedUrls).toContain('blob:mock-1')
  })

  it('opens a lightbox on thumbnail click and closes with Esc or the backdrop', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    pasteImage(screen.getByLabelText('消息输入框') as HTMLTextAreaElement, makeImageFile('lightbox.png'))
    const thumb = await screen.findByTestId('composer-thumb-0')
    fireEvent.click(thumb.querySelector('img')!)
    expect(screen.getByTestId('lightbox')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('lightbox')).toBeNull()
    fireEvent.click(thumb.querySelector('img')!)
    expect(screen.getByTestId('lightbox')).toBeTruthy()
    fireEvent.mouseDown(container.querySelector('.lightbox-backdrop')!)
    expect(screen.queryByTestId('lightbox')).toBeNull()
  })

  it('sends text + images as a real payload and clears both on success', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '看图' } })
    pasteImage(composer, makeImageFile('shot.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '看图', [
      expect.objectContaining({ mimeType: 'image/png', name: 'shot.png', dataBase64: expect.any(String) })
    ]))
    await waitFor(() => expect(composer.value).toBe(''))
    await waitFor(() => expect(screen.queryByTestId('composer-thumbs')).toBeNull())
    const bubbleImage = await waitFor(() => {
      const img = document.querySelector('img.user-bubble-image')
      expect(img).toBeTruthy()
      return img
    })
    expect(bubbleImage?.getAttribute('alt')).toBe('用户图片')
    expect(bubbleImage?.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(screen.queryByText(/\[1\s*张图片\]/)).toBeNull()
    expect(revokedUrls).toContain('blob:mock-0')
  })

  it('does not add a second user bubble when the backend echoes the annotated image prompt', async () => {
    const base = createMockHost()
    let listener: ((event: StreamEvent) => void) | undefined
    const host: PipiHostAPI = {
      ...base,
      subscribeStream: (_sessionId, callback) => {
        listener = callback
        return () => { listener = undefined }
      },
    }
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '看图' } })
    pasteImage(composer, makeImageFile('shot.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(document.querySelectorAll('.user-message').length).toBeGreaterThan(0))
    const before = document.querySelectorAll('[data-user-prompt]').length
    const note = '(Images are also embedded multimodally; prefer viewing them directly. If you use the read tool, use the paths above — do not invent paths like /home/workdir/attachments/.)'
    await act(async () => {
      listener?.({
        type: 'user_message',
        sessionId: 'welcome',
        id: 'srv-img',
        content: `看图\n\nAttached image file: /Users/demo/code/pipiui/.pi/attachments/shot.png\n${note}`,
      })
    })
    expect(document.querySelectorAll('[data-user-prompt]').length).toBe(before)
    expect(screen.getAllByText('看图').length).toBe(1)
    expect(screen.queryByText(/Attached image file/)).toBeNull()
    expect(screen.queryByText(/embedded multimodally/)).toBeNull()
    expect(document.querySelector('img.user-bubble-image')).toBeTruthy()
  })

  it('allows sending images without text', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    const composer = await renderChat(host)
    pasteImage(composer, makeImageFile('only.png'))
    await screen.findByTestId('composer-thumb-0')
    expect((screen.getByLabelText('发送消息') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '', [expect.objectContaining({ name: 'only.png' })]))
  })

  it('creates a session on the fly when sending from the empty 新会话 state', async () => {
    const base = createMockHost()
    const newSession = vi.spyOn(base, 'newSession')
    const sendPrompt = vi.spyOn(base, 'sendPrompt')
    // No sessions anywhere → the app boots in the empty 新会话 state.
    const host = { ...base, listSessions: async () => [] as Session[] }
    render(<App host={host} />)
    const composer = await screen.findByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '开个头' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(newSession).toHaveBeenCalledWith('pipiui'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1))
    const createdSession = await newSession.mock.results[0].value
    const [sessionId, prompt] = sendPrompt.mock.calls[0] as [string, string]
    expect(sessionId).toBe(createdSession.id)
    expect(prompt).toBe('开个头')
    // The optimistic user message lands in the transcript of the fresh session.
    await screen.findByText('开个头')
  })

  it('does not use Node process.stdout in the renderer App', () => {
    const candidates = [join('src', 'App.tsx'), join('packages', 'ui', 'src', 'App.tsx')]
    const found = candidates.map(candidate => join(process.cwd(), candidate)).find(existsSync)
    if (!found) throw new Error('cannot locate App.tsx')
    expect(readFileSync(found, 'utf8')).not.toMatch(/process\.stdout/)
  })

  it('keeps text and attachments and shows an error when sending fails', async () => {
    const host = { ...createMockHost(), sendPrompt: vi.fn(async () => { throw new Error('backend offline') }) }
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '别丢' } })
    pasteImage(composer, makeImageFile('keep.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    expect(await screen.findByText(/发送失败：backend offline/)).toBeTruthy()
    expect(composer.value).toBe('别丢')
    expect(screen.getByTestId('composer-thumb-0')).toBeTruthy()
  })

  it('rejects unsupported MIME types and oversized images with clear errors', async () => {
    await renderChat(createMockHost())
    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    pasteImage(textarea, makeImageFile('sketch.bmp', 'image/bmp'))
    expect(await screen.findByText(/不支持的图片格式：sketch.bmp/)).toBeTruthy()
    expect(screen.queryByTestId('composer-thumb-0')).toBeNull()
    pasteImage(textarea, makeImageFile('huge.png', 'image/png', 20 * 1024 * 1024 + 1))
    expect(await screen.findByText(/图片超过 20MB，无法添加：huge.png/)).toBeTruthy()
    expect(screen.queryByTestId('composer-thumb-0')).toBeNull()
  })

  it('blocks sending when the current model does not support images and never drops attachments', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-deepseek-deepseek-v3'))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('DeepSeek V3'))
    const composer = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    pasteImage(composer, makeImageFile('img.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    expect(await screen.findByText(/当前模型 DeepSeek V3 不支持图片附件/)).toBeTruthy()
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(screen.getByTestId('composer-thumb-0')).toBeTruthy()
  })

  it('keeps pasted image attachments across session switches and restores them', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    pasteImage(screen.getByLabelText('消息输入框') as HTMLTextAreaElement, makeImageFile('keep.png'))
    await screen.findByTestId('composer-thumb-0')
    // Switch to another session: welcome's thumbnails must not leak over, and
    // their object URLs must stay alive for when we come back.
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    expect(screen.queryByTestId('composer-thumb-0')).toBeNull()
    expect(revokedUrls).not.toContain('blob:mock-0')
    // Switch back: the very same attachment (same object URL) is restored.
    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    expect(await screen.findByTestId('composer-thumb-0')).toBeTruthy()
    expect(screen.getByTestId('composer-thumb-0').querySelector('img')?.getAttribute('src')).toBe('blob:mock-0')
    // The restored attachment is still sendable with its original file.
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '', [expect.objectContaining({ name: 'keep.png' })]))
  })

  it('does not resurrect image attachments after a successful send', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    pasteImage(screen.getByLabelText('消息输入框') as HTMLTextAreaElement, makeImageFile('sent.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(screen.queryByTestId('composer-thumbs')).toBeNull())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    fireEvent.click(container.querySelector('[data-session-id="welcome"]')!)
    expect(screen.queryByTestId('composer-thumbs')).toBeNull()
    expect(screen.queryByTestId('composer-thumb-0')).toBeNull()
  })
})

describe('update center settings flow', () => {
  it('closes settings and sends exactly one update request through the selected main session', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt').mockResolvedValue(undefined)
    const composer = await openModelModal(host)
    fireEvent.click(screen.getByTestId('model-tab-updates'))
    expect(await screen.findByTestId('update-center')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭设置' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '评估更新' }))
    await waitFor(() => expect(screen.queryByTestId('model-modal')).toBeNull())
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(1))
    expect(sendPrompt).toHaveBeenCalledWith('welcome', expect.stringMatching(/^\[\[PIPIUI_UPDATE_EVALUATION_INTENT\]\]\{"version":1,"id":"pi","name":"Pi","packageName":"@earendil-works\/pi-coding-agent","currentVersion":"0\.84\.0","latestVersion":"0\.84\.2"\}$/))
    expect((composer as HTMLTextAreaElement).value).toBe('')
  })
})

describe('vision routing (通用 tab)', () => {
  it('renders the 通用 tab with the switch and a disabled selector while the switch is off', async () => {
    const composer = await renderChat(createMockHost())
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    // 模型管理 stays the default tab
    expect(screen.getByTestId('model-tab-models').getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByTestId('model-tab-general'))
    await screen.findByTestId('vision-picker')
    const toggle = screen.getByTestId('vision-enabled-switch')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    // 开关关闭时选择器渲染但禁用
    const select = screen.getByTestId('vision-model-select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
  })

  it('reveals the selector listing only checked and vision-capable models once enabled', async () => {
    const host = createMockHost()
    const visionHost = visionHostMethods(host)
    await host.setHiddenModelIds(['xai/grok-4'])
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    fireEvent.click(screen.getByTestId('model-tab-general'))
    await screen.findByTestId('vision-picker')
    const select = screen.getByTestId('vision-model-select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('vision-enabled-switch'))
    await waitFor(() => expect(select.disabled).toBe(false))
    const values = Array.from(select.options).map(option => option.value)
    expect(values).toContain('anthropic/claude-sonnet-4')
    expect(values).toContain('openai/gpt-5')
    expect(values).not.toContain('openai/openai-codex') // supportsImages === false
    expect(values).not.toContain('deepseek/deepseek-v3') // supportsImages === false
    expect(values).not.toContain('xai/grok-4') // unchecked in 模型管理
    // 选择后持久化到主机，并显示「已选」提示
    fireEvent.change(select, { target: { value: 'anthropic/claude-sonnet-4' } })
    await waitFor(async () => expect(await visionHost.getVisionModel?.()).toBe('anthropic/claude-sonnet-4'))
    expect((await screen.findByTestId('vision-model-selected')).textContent).toContain('已选：anthropic/claude-sonnet-4')
  })

  it('keeps the selected vision model in the selector even when unchecked in 模型管理', async () => {
    const host = createMockHost()
    const visionHost = visionHostMethods(host)
    await host.setHiddenModelIds(['xai/grok-4'])
    await visionHost.setVisionEnabled?.(true)
    await visionHost.setVisionModel?.('xai/grok-4')
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    fireEvent.click(screen.getByTestId('model-tab-general'))
    await screen.findByTestId('vision-picker')
    const select = (await screen.findByTestId('vision-model-select')) as HTMLSelectElement
    await waitFor(() => expect(select.disabled).toBe(false))
    expect(select.value).toBe('xai/grok-4')
    expect(Array.from(select.options).map(option => option.value)).toContain('xai/grok-4')
  })

  it('clears the vision model when the switch is turned off', async () => {
    const host = createMockHost()
    const visionHost = visionHostMethods(host)
    const setModel = vi.spyOn(host, 'setVisionModel')
    await visionHost.setVisionEnabled?.(true)
    await visionHost.setVisionModel?.('anthropic/claude-sonnet-4')
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-modal')
    fireEvent.click(screen.getByTestId('model-tab-general'))
    await screen.findByTestId('vision-picker')
    const select = screen.getByTestId('vision-model-select') as HTMLSelectElement
    await waitFor(() => expect(select.disabled).toBe(false))
    fireEvent.click(screen.getByTestId('vision-enabled-switch'))
    await waitFor(() => expect(setModel).toHaveBeenCalledWith(null))
    expect(await visionHost.getVisionEnabled?.()).toBe(false)
    expect(select.disabled).toBe(true)
  })

  it('allows image sends with a non-multimodal main model when vision routing is enabled and a vision model is selected', async () => {
    const host = createMockHost()
    const visionHost = visionHostMethods(host)
    await visionHost.setVisionEnabled?.(true)
    await visionHost.setVisionModel?.('anthropic/claude-sonnet-4')
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-deepseek-deepseek-v3'))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('DeepSeek V3'))
    const composer = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    pasteImage(composer, makeImageFile('img.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalled())
    expect(screen.queryByText(/当前模型 DeepSeek V3 不支持图片附件/)).toBeNull()
  })

  it('still blocks image sends with a non-multimodal main model when vision routing is disabled', async () => {
    const host = createMockHost()
    const visionHost = visionHostMethods(host)
    await visionHost.setVisionEnabled?.(false)
    await visionHost.setVisionModel?.(null)
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-deepseek-deepseek-v3'))
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('DeepSeek V3'))
    const composer = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    pasteImage(composer, makeImageFile('img.png'))
    await screen.findByTestId('composer-thumb-0')
    fireEvent.click(screen.getByLabelText('发送消息'))
    expect(await screen.findByText(/当前模型 DeepSeek V3 不支持图片附件/)).toBeTruthy()
    expect(sendPrompt).not.toHaveBeenCalled()
    expect(screen.getByTestId('composer-thumb-0')).toBeTruthy()
  })
})

describe('composer textarea sizing and hints', () => {
  it('disables the native resize handle and hides the keyboard hint', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const css = readAppCss()
    expect(css).toContain('resize:none')
    expect(css).toContain('max-height:150px')
    expect(container.querySelector('.composer-options > span')).toBeNull()
    expect(screen.queryByText(/⌘↵ 发送/)).toBeNull()
    expect(screen.queryByText(/换行/)).toBeNull()
  })

  it('grows the textarea on multiline input and restores it after clearing', async () => {
    await renderChat(createMockHost())
    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'a\nb\nc\nd\ne' } })
    const grown = parseFloat(textarea.style.height)
    expect(grown).toBeGreaterThan(29)
    // deleting back to a single line shrinks it
    fireEvent.change(textarea, { target: { value: 'x' } })
    expect(parseFloat(textarea.style.height)).toBeLessThan(grown)
    // programmatic clear restores the single-line height
    fireEvent.change(textarea, { target: { value: '' } })
    expect(parseFloat(textarea.style.height)).toBeLessThan(grown)
    // very long content caps at the max height (internal scroll, no page growth)
    fireEvent.change(textarea, { target: { value: 'a\n'.repeat(100) } })
    expect(parseFloat(textarea.style.height)).toBeLessThanOrEqual(150)
  })

  it('keeps Enter-to-send and Shift+Enter newline behavior', async () => {
    const host = createMockHost()
    const sendPrompt = vi.spyOn(host, 'sendPrompt')
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: 'hello' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', 'hello'))
    await waitFor(() => expect(composer.value).toBe(''))
    fireEvent.change(composer, { target: { value: 'line1' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(sendPrompt).toHaveBeenCalledTimes(1)
    expect(composer.value).toBe('line1')
  })
})

describe('model visibility checkbox P0 regression', () => {
  it('rapid sequential unchecks stay unchecked when saves resolve out of order', async () => {
    const host = createMockHost()
    const original = host.setHiddenModelIds
    let delaySeq = 0
    vi.spyOn(host, 'setHiddenModelIds').mockImplementation(async ids => {
      const delay = delaySeq++ === 0 ? 50 : 5
      await new Promise(resolve => setTimeout(resolve, delay))
      return original(ids)
    })
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    // Two unchecks back-to-back while the first save is still in flight.
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 GPT-5'))
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 OpenAI Codex'))
    await new Promise(resolve => setTimeout(resolve, 120))
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('在快捷菜单显示 OpenAI Codex') as HTMLInputElement).checked).toBe(false)
    expect(await host.getHiddenModelIds()).toEqual(['openai/gpt-5', 'openai/openai-codex'])
  })

  it('unchecking a non-current model persists across close/reopen', async () => {
    const host = createMockHost()
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 GPT-5'))
    await waitFor(async () => expect(await host.getHiddenModelIds()).toContain('openai/gpt-5'))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(false)
    // re-check persists too
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 GPT-5'))
    await waitFor(async () => expect(await host.getHiddenModelIds()).not.toContain('openai/gpt-5'))
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(true)
  })

  it('provider tri-state unchecks every model of the provider and show-all restores them', async () => {
    const host = createMockHost()
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    const tri = screen.getByLabelText('openai 全部勾选') as HTMLInputElement
    expect(tri.checked).toBe(true)
    expect(tri.indeterminate).toBe(false)
    fireEvent.click(tri)
    await waitFor(async () => expect(await host.getHiddenModelIds()).toEqual(expect.arrayContaining(['openai/gpt-5', 'openai/openai-codex'])))
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('在快捷菜单显示 OpenAI Codex') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('openai 全部勾选') as HTMLInputElement).checked).toBe(false)
    // clicking unchecked tri-state restores every model
    fireEvent.click(screen.getByLabelText('openai 全部勾选'))
    await waitFor(async () => expect(await host.getHiddenModelIds()).toEqual([]))
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(true)
  })

  it('shows a dismissible save error instead of silently reverting when persistence fails', async () => {
    const host = { ...createMockHost(), setHiddenModelIds: vi.fn(async () => { throw new Error('disk full') }) }
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 openai'))
    await screen.findByTestId('model-row-openai-gpt-5')
    fireEvent.click(screen.getByLabelText('在快捷菜单显示 GPT-5'))
    expect(await screen.findByText(/保存模型可见性失败：disk full/)).toBeTruthy()
    // rollback kept the checkbox consistent (checked again), and the error is closable
    expect((screen.getByLabelText('在快捷菜单显示 GPT-5') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByTestId('visibility-error-close'))
    expect(screen.queryByText(/保存模型可见性失败/)).toBeNull()
  })

  it('unchecking the current model is allowed and the quick menu keeps it visible (Swift fallback)', async () => {
    const host = createMockHost()
    const composer = await renderChat(host)
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.click(screen.getByLabelText('展开 anthropic'))
    await screen.findByTestId('model-row-anthropic-claude-sonnet-4')
    const box = screen.getByLabelText('在快捷菜单显示 Claude Sonnet 4') as HTMLInputElement
    expect(box.disabled).toBe(false)
    fireEvent.click(box)
    await waitFor(async () => expect(await host.getHiddenModelIds()).toContain('anthropic/claude-sonnet-4'))
    expect((screen.getByLabelText('在快捷菜单显示 Claude Sonnet 4') as HTMLInputElement).checked).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(await screen.findByTestId('model-chip'))
    const row = await screen.findByTestId('quick-row-anthropic-claude-sonnet-4')
    expect(row.className).toContain('current')
  })
})

describe('composer thinking selector', () => {
  it('renders the line-art brain SVG + level in one compact flat capsule (no chevron)', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const chip = await screen.findByTestId('thinking-chip')
    const svg = screen.getByTestId('thinking-brain-icon')
    expect(chip.contains(svg)).toBe(true)
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('stroke-linejoin')).toBe('round')
    expect(svg.getAttribute('width')).toBe('13')
    expect(chip.textContent).toContain('medium')
    // Swift parity: no chevron glyph inside the chip.
    expect(chip.textContent).not.toContain('▾')
    const css = readAppCss()
    expect(css).toContain('.thinking-chip{display:inline-flex')
    expect(css).toContain('width:auto')
    expect(chip.className).toContain('thinking-chip')
    expect(chip.className).not.toContain('stretch')
  })

  it('styles both composer chips as Swift-aligned flat capsules (no accent bg, no chevron)', async () => {
    render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    const css = readAppCss()
    const modelRule = css.match(/\.model-chip\{[^}]*\}/)?.[0] ?? ''
    const thinkingRule = css.match(/\.thinking-chip\{[^}]*\}/)?.[0] ?? ''
    // Very light capsule from text/primary ~6%, never the accent highlight.
    expect(modelRule).toContain('color-mix(in srgb,var(--text) 6%,transparent)')
    expect(modelRule).not.toContain('var(--accent)')
    expect(modelRule).toContain('padding:5px 10px')
    expect(modelRule).toContain('border-radius:999px')
    expect(modelRule).toContain('gap:4px')
    expect(thinkingRule).toContain('color-mix(in srgb,var(--text) 6%,transparent)')
    expect(thinkingRule).not.toContain('var(--accent)')
    expect(thinkingRule).toContain('padding:5px 10px')
    expect(thinkingRule).toContain('border-radius:999px')
    expect(thinkingRule).toContain('gap:4px')
    expect(screen.getByTestId('model-chip').textContent).not.toContain('▾')
    expect(screen.getByTestId('thinking-chip').textContent).not.toContain('▾')
  })

  it('opens the menu from the level text area and updates the level', async () => {
    const host = createMockHost()
    const setThinkingLevel = vi.spyOn(host, 'setThinkingLevel')
    await renderChat(host)
    const chip = await screen.findByTestId('thinking-chip')
    fireEvent.click(chip.querySelector('.thinking-chip-level')!)
    await screen.findByTestId('thinking-menu')
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect((screen.getByTestId('thinking-row-medium') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('thinking-row-high'))
    await waitFor(() => expect(setThinkingLevel).toHaveBeenCalledWith('welcome', 'high'))
    await waitFor(() => expect(screen.getByTestId('thinking-chip').textContent).toContain('high'))
    expect(screen.queryByTestId('thinking-menu')).toBeNull()
  })

  it('renders a proven non-configurable reasoning model as model-default without dispatching a no-op level', async () => {
    const host = createMockHost()
    const fixedReasoner = {
      provider: 'fixed', id: 'fixed-reasoner', name: 'Fixed Reasoner', reasoning: true,
      thinkingConfigurable: false
    } as Model
    host.listModels = vi.fn(async () => [fixedReasoner])
    host.getModelState = vi.fn(async (): Promise<ModelState> => ({
      model: fixedReasoner,
      thinkingLevel: 'high',
      availableThinkingLevels: []
    }))
    const setThinkingLevel = vi.spyOn(host, 'setThinkingLevel')

    await renderChat(host)
    const chip = await screen.findByTestId('thinking-chip') as HTMLButtonElement
    expect(chip.disabled).toBe(true)
    expect(chip.textContent).toContain('auto')
    fireEvent.click(chip)
    expect(screen.queryByTestId('thinking-menu')).toBeNull()
    expect(setThinkingLevel).not.toHaveBeenCalled()
  })

  it('keeps real xai/grok-4.6 reported levels selectable across cold restore and catalog reconciliation', async () => {
    const base = createMockHost()
    const restoredSession: Session = {
      id: 'cold-grok',
      projectId: 'pipiui',
      name: '排查Grok思考强度',
      updatedAt: Date.now(),
      model: { provider: 'xai', modelId: 'grok-4.6' }
    }
    const coldSnapshot: ModelState = {
      model: { provider: 'xai', id: 'grok-4.6', name: 'Grok 4.6', reasoning: true },
      thinkingLevel: 'low',
      availableThinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh']
    }
    const catalogModel: Model = {
      provider: 'xai', id: 'grok-4.6', name: 'Grok 4.6', reasoning: true,
      thinkingConfigurable: true
    }
    const setThinkingLevel = vi.fn(base.setThinkingLevel)
    let resolveCatalog!: (models: Model[]) => void
    const host: PipiHostAPI = {
      ...base,
      listProjects: async () => [{ id: 'pipiui', name: 'PipiUI', path: '/Users/demo/code/pipiui' }],
      listSessions: async () => [restoredSession],
      getSessionHistory: async () => [],
      getModelState: vi.fn(async () => coldSnapshot),
      listModels: vi.fn(() => new Promise<Model[]>(resolve => { resolveCatalog = resolve })),
      setThinkingLevel
    }

    render(<App host={host} />)
    expect(await screen.findByLabelText('思考级别（当前：low）')).toBeTruthy()

    await act(async () => { resolveCatalog([catalogModel]) })

    const chip = await screen.findByLabelText('思考级别（当前：low）') as HTMLButtonElement
    expect(chip.disabled).toBe(false)
    fireEvent.click(chip)
    expect(screen.queryByTestId('thinking-row-off')).toBeNull()
    expect(screen.getByTestId('thinking-row-minimal')).toBeTruthy()
    expect(screen.getByTestId('thinking-row-low')).toBeTruthy()
    expect(screen.getByTestId('thinking-row-medium')).toBeTruthy()
    expect(screen.getByTestId('thinking-row-high')).toBeTruthy()
    expect(screen.getByTestId('thinking-row-xhigh')).toBeTruthy()
    expect(screen.queryByTestId('thinking-row-max')).toBeNull()
    fireEvent.click(screen.getByTestId('thinking-row-medium'))
    await waitFor(() => expect(setThinkingLevel).toHaveBeenCalledWith('cold-grok', 'medium'))
  })

  it('closes the thinking menu with Escape or the backdrop', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(await screen.findByTestId('thinking-chip'))
    await screen.findByTestId('thinking-menu')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('thinking-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('thinking-chip'))
    await screen.findByTestId('thinking-menu')
    fireEvent.mouseDown(container.querySelector('.quick-menu-backdrop')!)
    expect(screen.queryByTestId('thinking-menu')).toBeNull()
  })
})

describe('composer error dismissal', () => {
  it('closes the composer error with its × button', async () => {
    const host = { ...createMockHost(), setModel: vi.fn(async () => { throw new Error('模型不可用') }) }
    await renderChat(host)
    fireEvent.click(await screen.findByTestId('model-chip'))
    fireEvent.click(await screen.findByTestId('quick-row-openai-gpt-5'))
    expect(await screen.findByText(/切换模型失败：模型不可用/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('composer-error-close'))
    expect(screen.queryByTestId('composer-error')).toBeNull()
  })
})

describe('model provider deletion', () => {
  it('requires confirmation and cancels without changes', async () => {
    const host = createMockHost()
    const remove = vi.spyOn(host, 'removeProviderCredentials')
    await openModelModal(host)
    await screen.findByTestId('model-provider-deepseek')
    fireEvent.click(screen.getByTestId('delete-provider-deepseek'))
    await screen.findByTestId('delete-confirm-deepseek')
    fireEvent.click(screen.getByTestId('delete-cancel-deepseek'))
    expect(screen.queryByTestId('delete-confirm-deepseek')).toBeNull()
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes the provider after confirmation and refreshes the catalog', async () => {
    const host = createMockHost()
    const remove = vi.spyOn(host, 'removeProviderCredentials')
    await openModelModal(host)
    await screen.findByTestId('model-provider-deepseek')
    fireEvent.click(screen.getByTestId('delete-provider-deepseek'))
    fireEvent.click(await screen.findByTestId('delete-confirm-btn-deepseek'))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('deepseek'))
    await waitFor(() => expect(screen.queryByTestId('model-provider-deepseek')).toBeNull())
    expect((await host.listModels()).some(model => model.provider === 'deepseek')).toBe(false)
  })

  it('shows an error and keeps the provider when deletion fails', async () => {
    const host = { ...createMockHost(), removeProviderCredentials: vi.fn(async () => { throw new Error('auth locked') }) }
    await openModelModal(host)
    await screen.findByTestId('model-provider-deepseek')
    fireEvent.click(screen.getByTestId('delete-provider-deepseek'))
    fireEvent.click(await screen.findByTestId('delete-confirm-btn-deepseek'))
    expect(await screen.findByText(/删除失败：auth locked/)).toBeTruthy()
    expect(screen.getByTestId('model-provider-deepseek')).toBeTruthy()
  })

  it('safely switches to another model when the current provider is deleted', async () => {
    const host = createMockHost()
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    const composer = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(composer, { target: { value: '/model' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await screen.findByTestId('model-provider-anthropic')
    fireEvent.click(screen.getByTestId('delete-provider-anthropic'))
    fireEvent.click(await screen.findByTestId('delete-confirm-btn-anthropic'))
    await waitFor(() => expect(container.querySelector('.model-detail')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('model-chip').textContent).toContain('GPT-5'))
  })
})

describe('model provider add (pi auth flow)', () => {
  it('lists providers from the host with status and per-auth-type actions', async () => {
    await openModelModal(createMockHost())
    fireEvent.click(await screen.findByTestId('model-add-button'))
    await screen.findByTestId('provider-row-anthropic')
    expect(screen.getByTestId('provider-row-anthropic').textContent).toContain('已登录（oauth）')
    expect(screen.getByTestId('provider-row-deepseek').textContent).toContain('未登录')
    expect(screen.getByTestId('login-anthropic-oauth')).toBeTruthy()
    expect(screen.getByTestId('login-deepseek-api-key')).toBeTruthy()
  })

  it('completes an api-key login, clears the input, and never retains the key in the renderer', async () => {
    const host = createMockHost()
    await openModelModal(host)
    fireEvent.click(await screen.findByTestId('model-add-button'))
    fireEvent.click(await screen.findByTestId('login-github-copilot-api-key'))
    await screen.findByTestId('provider-login-prompt')
    const secret = 'sk-abcdef0123456789'
    fireEvent.change(screen.getByTestId('provider-login-input'), { target: { value: secret } })
    fireEvent.click(screen.getByTestId('provider-login-submit'))
    await waitFor(() => expect(screen.queryByTestId('provider-login')).toBeNull())
    await screen.findByTestId('model-add-button') // back on manage view
    expect(document.body.textContent).not.toContain(secret)
    expect(screen.queryByDisplayValue(secret)).toBeNull()
    expect((await host.authProviders()).find(p => p.id === 'github-copilot')?.authenticated).toBe(true)
  })

  it('opens the oauth URL in the default browser automatically and completes on continue', async () => {
    const host = createMockHost()
    const openExternal = vi.spyOn(host as { openExternal: (url: string) => Promise<void> }, 'openExternal')
    await openModelModal(host)
    fireEvent.click(await screen.findByTestId('model-add-button'))
    fireEvent.click(await screen.findByTestId('login-github-copilot-oauth'))
    await screen.findByTestId('provider-login-auth')
    expect(screen.getByTestId('provider-login-url').textContent).toContain('auth.example.com')
    expect(screen.getByTestId('provider-login-code').textContent).toContain('ABCD-1234')
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://auth.example.com/github-copilot'))
    fireEvent.click(screen.getByTestId('provider-login-continue'))
    await waitFor(() => expect(screen.queryByTestId('provider-login')).toBeNull())
    expect((await host.authProviders()).find(p => p.id === 'github-copilot')?.authenticated).toBe(true)
  })

  it('keeps the oauth URL visible and allows retry when opening the browser fails', async () => {
    const host = createMockHost()
    const openExternal = vi.spyOn(host as { openExternal: (url: string) => Promise<void> }, 'openExternal')
      .mockRejectedValueOnce(new Error('browser unavailable'))
      .mockResolvedValueOnce(undefined)
    await openModelModal(host)
    fireEvent.click(await screen.findByTestId('model-add-button'))
    fireEvent.click(await screen.findByTestId('login-github-copilot-oauth'))
    expect((await screen.findByTestId('provider-login-browser-error')).textContent).toContain('browser unavailable')
    expect(screen.getByTestId('provider-login-url').textContent).toContain('auth.example.com')
    fireEvent.click(screen.getByTestId('provider-login-open'))
    await waitFor(() => expect(openExternal).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId('provider-login-browser-error')).toBeNull())
  })

  it('cancels the oauth flow and returns to the provider list', async () => {
    await openModelModal(createMockHost())
    fireEvent.click(await screen.findByTestId('model-add-button'))
    fireEvent.click(await screen.findByTestId('login-github-copilot-oauth'))
    await screen.findByTestId('provider-login-auth')
    fireEvent.click(screen.getByTestId('provider-login-cancel'))
    await waitFor(() => expect(screen.queryByTestId('provider-login')).toBeNull())
    expect(screen.getByTestId('provider-row-github-copilot')).toBeTruthy()
  })
})
