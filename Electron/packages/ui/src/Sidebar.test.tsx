// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relativeTime, Sidebar, statusCaption } from './Sidebar'
import type { SidebarProps, SidebarSession } from './Sidebar'

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

const now = Date.now()

function session(overrides: Partial<SidebarSession> & { id: string }): SidebarSession {
  return {
    projectId: 'p1',
    title: overrides.id,
    provider: 'openai',
    modelId: 'gpt-4o',
    status: 'idle',
    updatedAt: now - 5 * 60_000,
    ...overrides
  }
}

function defaultProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    projects: [
      {
        id: 'p1',
        name: 'demo-project',
        path: '/Users/me/demo-project',
        sessions: [session({ id: 's1' }), session({ id: 's2', status: 'running' })]
      },
      {
        id: 'p2',
        name: 'other-project',
        path: '/Users/me/other-project',
        sessions: [session({ id: 's3', projectId: 'p2', provider: 'anthropic', modelId: 'claude-sonnet-4' })]
      }
    ],
    pinnedSessions: [session({ id: 'pin1', status: 'completed' })],
    archivedSessions: [],
    expandedIds: ['p1'],
    selectedSessionId: null,
    searchQuery: '',
    visibleLimit: 10,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onToggleProject: vi.fn(),
    onSelectSession: vi.fn(),
    onNewSession: vi.fn(),
    onProjectMenu: vi.fn(),
    onSearch: vi.fn(),
    onShowMore: vi.fn(),
    ...overrides
  }
}

describe('Sidebar', () => {
  it('renders its pane toggle above search, pinned section, project rows and session rows', () => {
    render(<Sidebar {...defaultProps()} />)
    expect(screen.getByRole('navigation', { name: '会话侧边栏' })).toBeTruthy()
    const brand = screen.getByLabelText('PipiUI')
    expect(brand.closest('.sb-topbar')).toBeTruthy()
    expect(brand.textContent).toBe('Pipi UI')
    expect(brand.querySelector('span')?.textContent).toBe('i')
    expect(screen.getByRole('button', { name: '收起左栏' }).closest('.sb-topbar')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: '搜索所有会话' })).toBeTruthy()
    expect(screen.getByText('置顶')).toBeTruthy()
    expect(screen.getByText('项目')).toBeTruthy()
    expect(screen.getAllByTestId('project-row')).toHaveLength(2)
    // p1 expanded → its two sessions visible; p2 collapsed → hidden.
    expect(screen.getAllByTestId('session-row')).toHaveLength(3) // pin1 + s1 + s2
    expect(screen.getByText('pin1')).toBeTruthy()
    expect(screen.queryByText('s3')).toBeNull()
  })

  it('toggles a project via the row button and reports aria-expanded', () => {
    const props = defaultProps()
    render(<Sidebar {...props} />)
    const row = screen.getAllByTestId('project-row')[0]
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(within(row).getByRole('button', { name: /收起项目 demo-project/ }))
    expect(props.onToggleProject).toHaveBeenCalledWith('p1')
  })

  it('collapsed project hides its sessions; expanding via expandedIds shows them', () => {
    const props = defaultProps({ expandedIds: [] })
    render(<Sidebar {...props} />)
    expect(screen.queryByText('s1')).toBeNull()
    expect(screen.queryByText('s2')).toBeNull()

    // Controlled: parent feeds the id back → folder opens.
    props.expandedIds = ['p1']
    render(<Sidebar {...props} />)
    expect(screen.getByText('s1')).toBeTruthy()
    expect(screen.getByText('s2')).toBeTruthy()
  })

  it('project menu reports reveal/remove and renames inline without touching the folder path', async () => {
    const onRenameProject = vi.fn()
    const props = defaultProps({ onRenameProject })
    render(<Sidebar {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'demo-project 项目菜单' })[0])
    const menu = screen.getByTestId('project-menu')
    expect(menu.getAttribute('role')).toBe('menu')
    expect(within(menu).queryByRole('menuitem', { name: '新建会话' })).toBeNull()

    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }))
    expect(props.onProjectMenu).not.toHaveBeenCalled()
    const input = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(input, { target: { value: '我的仓库' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRenameProject).toHaveBeenCalledWith('p1', '我的仓库'))

    fireEvent.click(screen.getAllByRole('button', { name: 'demo-project 项目菜单' })[0])
    fireEvent.click(within(screen.getByTestId('project-menu')).getByRole('menuitem', { name: '在 Finder 中显示' }))
    expect(props.onProjectMenu).toHaveBeenLastCalledWith('p1', 'reveal')

    fireEvent.click(screen.getAllByRole('button', { name: 'demo-project 项目菜单' })[0])
    fireEvent.click(within(screen.getByTestId('project-menu')).getByRole('menuitem', { name: '移除项目' }))
    expect(props.onProjectMenu).toHaveBeenLastCalledWith('p1', 'remove')
  })

  it('the + ghost reports a new-session intent and the menu does not offer it', () => {
    const props = defaultProps()
    render(<Sidebar {...props} />)

    fireEvent.click(screen.getAllByRole('button', { name: /demo-project 新建会话/ })[0])
    expect(props.onNewSession).toHaveBeenCalledWith('p1')

    fireEvent.click(screen.getAllByRole('button', { name: 'demo-project 项目菜单' })[0])
    expect(within(screen.getByTestId('project-menu')).queryByRole('menuitem', { name: '新建会话' })).toBeNull()
  })

  it('opens the native project-folder picker without showing a path text field', async () => {
    const onAddProject = vi.fn(async () => true)
    render(<Sidebar {...defaultProps({ onAddProject })} />)
    fireEvent.click(screen.getByRole('button', { name: '添加项目' }))
    await waitFor(() => expect(onAddProject).toHaveBeenCalledWith())
    expect(screen.queryByRole('textbox', { name: '项目路径' })).toBeNull()
  })

  it('typing in the search box reports the query upward (controlled)', () => {
    const props = defaultProps()
    render(<Sidebar {...props} />)
    const input = screen.getByRole('searchbox', { name: '搜索所有会话' })
    fireEvent.change(input, { target: { value: 'claude' } })
    expect(props.onSearch).toHaveBeenCalledWith('claude')
  })

  it('drags projects to a new manual position', () => {
    const onMoveProject = vi.fn()
    render(<Sidebar {...defaultProps({ onMoveProject })} />)
    const [first, second] = screen.getAllByTestId('project-row')
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(first, { dataTransfer: transfer })
    fireEvent.dragOver(second, { dataTransfer: transfer, clientY: 10 })
    fireEvent.drop(second, { dataTransfer: transfer, clientY: 10 })
    expect(onMoveProject).toHaveBeenCalledWith('p1', 'p2', 'after')
  })

  it('reorders sessions and moves one onto another project', () => {
    const onMoveSession = vi.fn()
    render(<Sidebar {...defaultProps({ onMoveSession })} />)
    const rows = screen.getAllByTestId('session-row')
    const s1 = rows.find(row => row.getAttribute('data-session-id') === 's1')!
    const s2 = rows.find(row => row.getAttribute('data-session-id') === 's2')!
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(s1, { dataTransfer: transfer })
    fireEvent.dragOver(s2, { dataTransfer: transfer, clientY: 10 })
    fireEvent.drop(s2, { dataTransfer: transfer, clientY: 10 })
    expect(onMoveSession).toHaveBeenLastCalledWith('s1', 'p1', 's2', 'after')

    fireEvent.dragStart(s1, { dataTransfer: transfer })
    const p2 = screen.getAllByTestId('project-row')[1]
    fireEvent.dragOver(p2, { dataTransfer: transfer })
    fireEvent.drop(p2, { dataTransfer: transfer })
    expect(onMoveSession).toHaveBeenLastCalledWith('s1', 'p2')
  })

  it('pins by dropping into the pinned section and unpins by dropping onto a project', () => {
    const onMoveSession = vi.fn()
    const onMoveSessionToPinned = vi.fn()
    render(<Sidebar {...defaultProps({ onMoveSession, onMoveSessionToPinned })} />)
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const row = (screen.getAllByTestId('session-row')).find(item => item.getAttribute('data-session-id') === 's1')!
    const pinned = screen.getByLabelText('置顶会话')
    fireEvent.dragStart(row, { dataTransfer: transfer })
    fireEvent.dragOver(pinned, { dataTransfer: transfer })
    fireEvent.drop(pinned, { dataTransfer: transfer })
    expect(onMoveSessionToPinned).toHaveBeenCalledWith('s1', undefined, 'after')

    const pinnedRow = (screen.getAllByTestId('session-row')).find(item => item.getAttribute('data-session-id') === 'pin1')!
    const project = screen.getAllByTestId('project-row')[1]
    fireEvent.dragStart(pinnedRow, { dataTransfer: transfer })
    fireEvent.dragOver(project, { dataTransfer: transfer })
    fireEvent.drop(project, { dataTransfer: transfer })
    expect(onMoveSession).toHaveBeenCalledWith('pin1', 'p2')
  })

  it('reorders pinned sessions by dragging one over another', () => {
    const onMoveSessionToPinned = vi.fn()
    render(<Sidebar {...defaultProps({ pinnedSessions: [session({ id: 'pin1' }), session({ id: 'pin2' })], onMoveSessionToPinned })} />)
    const rows = screen.getAllByTestId('session-row')
    const pin1 = rows.find(item => item.getAttribute('data-session-id') === 'pin1')!
    const pin2 = rows.find(item => item.getAttribute('data-session-id') === 'pin2')!
    const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(pin1, { dataTransfer: transfer })
    fireEvent.dragOver(pin2, { dataTransfer: transfer, clientY: 10 })
    fireEvent.drop(pin2, { dataTransfer: transfer, clientY: 10 })
    expect(onMoveSessionToPinned).toHaveBeenCalledWith('pin1', 'pin2', 'after')
  })

  it('filters projects and sessions by title', () => {
    const props = defaultProps({ searchQuery: 's2' })
    render(<Sidebar {...props} />)
    expect(screen.getByText('s2')).toBeTruthy()
    expect(screen.queryByText('s1')).toBeNull()
    expect(screen.queryByText('pin1')).toBeNull()
  })

  it('matches sessions by provider and model id', () => {
    const props = defaultProps({ searchQuery: 'anthropic' })
    render(<Sidebar {...props} />)
    expect(screen.getByText('s3')).toBeTruthy()
    expect(screen.queryByText('s1')).toBeNull()

    cleanup()
    const byModel = defaultProps({ searchQuery: 'claude-sonnet' })
    render(<Sidebar {...byModel} />)
    expect(screen.getByText('s3')).toBeTruthy()
  })

  it('matches projects by name/path and drops projects without hits', () => {
    const props = defaultProps({ searchQuery: 'other' })
    render(<Sidebar {...props} />)
    expect(screen.getByText('other-project')).toBeTruthy()
    expect(screen.queryByText('demo-project')).toBeNull()
  })

  it('renders the pinned section from pinnedSessions regardless of projects', () => {
    const props = defaultProps({ pinnedSessions: [session({ id: 'pinA' }), session({ id: 'pinB', status: 'failed' })] })
    render(<Sidebar {...props} />)
    expect(screen.getByText('pinA')).toBeTruthy()
    expect(screen.getByText('pinB')).toBeTruthy()
  })

  it('shows 更多 only when projects exceed visibleLimit and reports onShowMore', () => {
    const props = defaultProps({ visibleLimit: 1 })
    render(<Sidebar {...props} />)
    expect(screen.getAllByTestId('project-row')).toHaveLength(1)
    const more = screen.getByTestId('show-more')
    expect(more.textContent).toBe('更多')
    fireEvent.click(more)
    expect(props.onShowMore).toHaveBeenCalledTimes(1)

    // No overflow → no 更多.
    cleanup()
    const full = defaultProps({ visibleLimit: 10 })
    render(<Sidebar {...full} />)
    expect(screen.queryByTestId('show-more')).toBeNull()
  })

  it('paginates per-project sessions: 10 default, 更多 reveals a page, then 收起 collapses', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => session({ id: `s${i}`, projectId: 'p1' }))
    const props = defaultProps({
      projects: [{ id: 'p1', name: 'demo-project', path: '/Users/me/demo', sessions }],
      pinnedSessions: []
    })
    render(<Sidebar {...props} />)
    // Default: 10 visible + 更多 toggle (not 收起 yet).
    expect(screen.getAllByTestId('session-row')).toHaveLength(10)
    const more = screen.getByTestId('show-more-sessions')
    expect(more.textContent).toBe('更多')
    // Click 更多 → reveals another page (capped at the 15-session total).
    fireEvent.click(more)
    expect(screen.getAllByTestId('session-row')).toHaveLength(15)
    const collapse = screen.getByTestId('show-more-sessions')
    expect(collapse.textContent).toBe('收起')
    // Click 收起 → back to the 10-row cap.
    fireEvent.click(collapse)
    expect(screen.getAllByTestId('session-row')).toHaveLength(10)
    expect(screen.getByTestId('show-more-sessions').textContent).toBe('更多')
  })

  it('hides the per-project session toggle when sessions ≤ 10', () => {
    render(<Sidebar {...defaultProps()} />)
    // p1 has 2 sessions, p2 (collapsed) has 1 → no session toggle anywhere.
    expect(screen.queryByTestId('show-more-sessions')).toBeNull()
  })

  it('keeps per-project session pagination independent across projects', () => {
    const sessionsP1 = Array.from({ length: 12 }, (_, i) => session({ id: `a${i}`, projectId: 'p1' }))
    const sessionsP2 = Array.from({ length: 13 }, (_, i) => session({ id: `b${i}`, projectId: 'p2' }))
    const props = defaultProps({
      projects: [
        { id: 'p1', name: 'demo-project', path: '/x', sessions: sessionsP1 },
        { id: 'p2', name: 'other-project', path: '/y', sessions: sessionsP2 }
      ],
      pinnedSessions: [],
      expandedIds: ['p1', 'p2']
    })
    render(<Sidebar {...props} />)
    // Both expanded: 10 + 10 = 20 rows, plus two independent toggles.
    expect(screen.getAllByTestId('session-row')).toHaveLength(20)
    const toggles = screen.getAllByTestId('show-more-sessions')
    expect(toggles).toHaveLength(2)
    // Expand only p1's sessions; p2 stays capped.
    fireEvent.click(toggles[0])
    expect(screen.getAllByTestId('session-row')).toHaveLength(22)
  })

  it('search bypasses per-project session pagination and shows every match', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => session({ id: `find${i}`, projectId: 'p1' }))
    const props = defaultProps({
      projects: [{ id: 'p1', name: 'demo-project', path: '/x', sessions }],
      pinnedSessions: [],
      searchQuery: 'find'
    })
    render(<Sidebar {...props} />)
    expect(screen.getAllByTestId('session-row')).toHaveLength(15)
    expect(screen.queryByTestId('show-more-sessions')).toBeNull()
  })

  it('search results bypass pagination so every match is visible', () => {
    const props = defaultProps({ visibleLimit: 1, searchQuery: 's' })
    render(<Sidebar {...props} />)
    expect(screen.getAllByTestId('project-row')).toHaveLength(2)
    expect(screen.queryByTestId('show-more')).toBeNull()
  })

  it('marks the selected session row and reports clicks', () => {
    const props = defaultProps({ selectedSessionId: 's2' })
    render(<Sidebar {...props} />)
    const row = screen.getByText('s2').closest('.sb-session')!
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.classList.contains('sb-selected')).toBe(true)
    fireEvent.click(row)
    expect(props.onSelectSession).toHaveBeenCalledWith('s2')
    expect(props.onSelectSession).toHaveBeenCalledTimes(1)
  })

  it('fires session select and new-session callbacks on the first click', () => {
    const props = defaultProps()
    render(<Sidebar {...props} />)
    fireEvent.click(screen.getByText('s1').closest('.sb-session')!)
    expect(props.onSelectSession).toHaveBeenCalledTimes(1)
    expect(props.onSelectSession).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getAllByRole('button', { name: /demo-project 新建会话/ })[0])
    expect(props.onNewSession).toHaveBeenCalledTimes(1)
    expect(props.onNewSession).toHaveBeenCalledWith('p1')
  })

  it.each([
    ['running', '进行中'],
    ['stalled', '停滞']
  ] as const)('renders a distinct status caption and glyph for %s', (status, caption) => {
    const props = defaultProps({
      projects: [{ id: 'p1', name: 'demo', sessions: [session({ id: 'x', status })] }],
      pinnedSessions: []
    })
    render(<Sidebar {...props} />)
    const row = screen.getByTestId('session-row')
    expect(row.getAttribute('data-status')).toBe(status)
    expect(within(row).getByText(caption)).toBeTruthy()
    // status badge also carries data-status for styling
    expect(screen.getByText(caption).closest('.sb-status')!.getAttribute('data-status')).toBe(status)
  })

  it.each(['completed', 'interrupted', 'failed'] as const)('renders relativeTime as the caption for %s', (status) => {
    const updatedAt = now - 12 * 60_000
    const caption = relativeTime(updatedAt)
    const props = defaultProps({
      projects: [{ id: 'p1', name: 'demo', sessions: [session({ id: 'x', status, updatedAt })] }],
      pinnedSessions: []
    })
    render(<Sidebar {...props} />)
    const row = screen.getByTestId('session-row')
    expect(row.getAttribute('data-status')).toBe(status)
    expect(within(row).getByText(caption)).toBeTruthy()
    expect(screen.getByText(caption).closest('.sb-status')!.getAttribute('data-status')).toBe(status)
  })

  it('shows 子任务中 vs N 个子任务 by subagent count', () => {
    const one = defaultProps({
      projects: [{ id: 'p1', name: 'demo', sessions: [session({ id: 'a', status: 'subagents-running', subagentCount: 1 })] }]
    })
    render(<Sidebar {...one} />)
    expect(screen.getByText('子任务中')).toBeTruthy()

    const many = defaultProps({
      projects: [{ id: 'p1', name: 'demo', sessions: [session({ id: 'b', status: 'subagents-running', subagentCount: 3 })] }]
    })
    render(<Sidebar {...many} />)
    expect(screen.getByText('3 个子任务')).toBeTruthy()
  })

  it('shows relative time for idle sessions', () => {
    const props = defaultProps({
      projects: [{ id: 'p1', name: 'demo', sessions: [session({ id: 'old', updatedAt: now - 3 * 3600_000 })] }]
    })
    render(<Sidebar {...props} />)
    expect(screen.getByText('3小时前')).toBeTruthy()
  })

  it('renders the provider model logo from ProviderLogo', () => {
    const props = defaultProps({
      projects: [{ id: 'p1', name: 'demo', sessions: [session({ id: 'logo', provider: 'openai', modelId: 'gpt-4o' })] }],
      pinnedSessions: []
    })
    render(<Sidebar {...props} />)
    const logo = screen.getByTestId('provider-logo-openai')
    const svg = logo.querySelector('svg')!
    expect(svg).toBeTruthy()
    expect(svg.style.width).toBe('78%')
    expect(svg.style.height).toBe('78%')
  })

  it('shows the empty state for a search with no matches', () => {
    const props = defaultProps({ searchQuery: 'zzz-no-such-thing' })
    render(<Sidebar {...props} />)
    const empty = screen.getByTestId('sidebar-empty')
    expect(empty.textContent).toBe('无匹配结果')
  })

  it('shows a generic empty state when there is nothing at all', () => {
    const props = defaultProps({ projects: [], pinnedSessions: [] })
    render(<Sidebar {...props} />)
    expect(screen.getByTestId('sidebar-empty').textContent).toBe('暂无项目与会话')
  })

  it('pins the settings footer below the list and reports gear clicks', () => {
    const props = defaultProps({ onOpenSettings: vi.fn() })
    const { container } = render(<Sidebar {...props} />)
    const footer = screen.getByTestId('sidebar-footer')
    // Footer is a sibling AFTER the scrollable list, so a long list never pushes it out.
    const scroll = container.querySelector('.sb-scroll')!
    expect(scroll.nextElementSibling).toBe(footer)
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('renders the Swift-parity footer actions in order and reports every click', () => {
    const onOpenSettings = vi.fn()
    const onOpenComputerUse = vi.fn()
    const onOpenRemote = vi.fn()
    const onOpenSubagentModels = vi.fn()
    render(<Sidebar {...defaultProps({ onOpenSettings, onOpenComputerUse, onOpenRemote, onOpenSubagentModels })} />)
    const buttons = within(screen.getByTestId('sidebar-footer')).getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['设置', '桌面控制', '远程控制', 'Subagent 模型'])
    buttons.forEach(button => fireEvent.click(button))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(onOpenComputerUse).toHaveBeenCalledTimes(1)
    expect(onOpenRemote).toHaveBeenCalledTimes(1)
    expect(onOpenSubagentModels).toHaveBeenCalledTimes(1)
  })

  it('omits the footer when no settings handler is wired', () => {
    render(<Sidebar {...defaultProps()} />)
    expect(screen.queryByTestId('sidebar-footer')).toBeNull()
  })

  it('reports pin/archive and commits rename from the inline session-title editor', async () => {
    const onPin = vi.fn()
    const onRename = vi.fn()
    const onArchive = vi.fn()
    const props = defaultProps({ onPinSession: onPin, onRenameSession: onRename, onArchiveSession: onArchive })
    const { container } = render(<Sidebar {...props} />)
    const s1 = container.querySelector('[data-session-id="s1"]')!
    const actionButtons = Array.from(s1.querySelectorAll('.sb-session-action'))
    const labels = actionButtons.map(button => button.getAttribute('aria-label'))
    expect(labels).toContain('置顶')
    expect(labels).toContain('修改标题')
    expect(labels).toContain('归档会话')
    const archiveBtn = s1.querySelector('.sb-session-action[aria-label="归档会话"]') as HTMLElement
    archiveBtn.click()
    expect(onArchive).toHaveBeenCalledWith('s1')
    const pinBtn = s1.querySelector('.sb-session-action[aria-label="置顶"]') as HTMLElement
    pinBtn.click()
    expect(onPin).toHaveBeenCalledWith('s1')
    const renameBtn = s1.querySelector('.sb-session-action[aria-label="修改标题"]') as HTMLElement
    fireEvent.click(renameBtn)
    const input = within(s1 as HTMLElement).getByRole('textbox', { name: '会话名称' })
    fireEvent.change(input, { target: { value: '新的会话名称' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('s1', '新的会话名称'))
    await waitFor(() => expect(within(s1 as HTMLElement).queryByRole('textbox', { name: '会话名称' })).toBeNull())
  })

  it('optically centers the wordmark across the full topbar and keeps the hamburger clickable', () => {
    const css = readFileSync(join(import.meta.dirname, 'sidebar.css'), 'utf8')
    expect(css).toMatch(/\.sb-topbar\{[^}]*position:relative/)
    expect(css).toMatch(/\.sb-brand-wordmark\{[^}]*position:absolute[^}]*inset:0/)
    expect(css).toMatch(/\.sb-brand-wordmark\{[^}]*justify-content:center/)
    expect(css).toMatch(/\.sb-pane-toggle\{[^}]*-webkit-app-region:no-drag/)
  })

  it('hides the status caption and overlays the hover actions on the right corner (Swift parity CSS)', () => {
    const css = readFileSync(join(import.meta.dirname, 'sidebar.css'), 'utf8')
    // The status caption (time/subtitle) fades on hover/focus so the actions own that corner.
    expect(css).toMatch(/\.sb-session:hover \.sb-status/)
    expect(css).toMatch(/\.sb-session:focus-within \.sb-status\{opacity:0\}/)
    // The actions container is an absolutely-positioned overlay at the row's right corner.
    expect(css).toMatch(/\.sb-session-actions\{[^}]*position:absolute[^}]*\}/)
    expect(css).toMatch(/\.sb-session:hover \.sb-session-actions,?/)
    expect(css).toMatch(/\.sb-session-actions\{[^}]*opacity:0;[^}]*pointer-events:none[^}]*\}/)
    // The row is positioned so the hover actions can overlay the right corner.
    expect(css).toMatch(/\.sb-session\{[^}]*position:relative[^}]*\}/)
    // No fixed min-width on status — the title fills available space and hover actions overlay.
    expect(css).not.toMatch(/\.sb-status\{[^}]*min-width:[^}]*\}/)
  })

  it('keeps the caption and the three hover actions mounted on the row across mouseenter/mouseleave', () => {
    const props = defaultProps({ onPinSession: vi.fn(), onRenameSession: vi.fn(), onArchiveSession: vi.fn() })
    const { container } = render(<Sidebar {...props} />)
    const s1 = container.querySelector('[data-session-id="s1"]')!
    const status = s1.querySelector('.sb-status') as HTMLElement
    const actions = s1.querySelector('.sb-session-actions') as HTMLElement
    expect(status.textContent).toContain('分钟前') // idle relative time visible at rest
    expect(actions.querySelectorAll('.sb-session-action')).toHaveLength(3)
    // CSS drives the swap (opacity) — DOM stays mounted for the a11y labels.
    fireEvent.mouseEnter(s1)
    expect(status.textContent).toContain('分钟前')
    expect(actions.querySelectorAll('.sb-session-action')).toHaveLength(3)
    fireEvent.mouseLeave(s1)
    expect(status.textContent).toContain('分钟前')
    expect(actions.querySelectorAll('.sb-session-action')).toHaveLength(3)
  })

  it('renders the archived section globally with expand/collapse and unarchive', () => {
    const onUnarchive = vi.fn()
    const archived = [session({ id: 'arch1', projectId: 'p1', status: 'completed' })]
    const props = defaultProps({ archivedSessions: archived, onUnarchiveSession: onUnarchive })
    render(<Sidebar {...props} />)
    const toggle = screen.getByRole('button', { name: /已归档/ })
    expect(toggle.textContent).toContain('1')
    // Collapsed by default: archived row hidden.
    expect(screen.queryByText('arch1')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('arch1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /取消归档/ }))
    expect(onUnarchive).toHaveBeenCalledWith('arch1')
  })

  it('labels external rows with a dedicated source icon and hides Pi-only actions', () => {
    const onPin = vi.fn()
    const onRename = vi.fn()
    const onArchive = vi.fn()
    const onSelect = vi.fn()
    render(<Sidebar {...defaultProps({
      pinnedSessions: [],
      onPinSession: onPin,
      onRenameSession: onRename,
      onArchiveSession: onArchive,
      onSelectSession: onSelect,
      projects: [{
        id: 'p1',
        name: 'demo-project',
        sessions: [
          session({ id: 's1' }),
          session({ id: 'ext:claude:abc', title: 'Claude 记录', source: 'claude', provider: 'claude' }),
        ],
      }],
    })} />)
    const external = document.querySelector('[data-session-id="ext:claude:abc"]') as HTMLElement
    expect(external.getAttribute('data-session-source')).toBe('claude')
    expect(external.getAttribute('aria-label')).toBe('Anthropic/Claude · Claude 记录')
    expect(external.getAttribute('title')).toBe('Anthropic/Claude · Claude 记录')
    expect(within(external).getByTestId('session-source-claude')).toBeTruthy()
    expect(within(external).queryByRole('button', { name: '置顶' })).toBeNull()
    expect(within(external).queryByRole('button', { name: '修改标题' })).toBeNull()
    expect(within(external).queryByRole('button', { name: '归档会话' })).toBeNull()
    fireEvent.click(external)
    expect(onSelect).toHaveBeenCalledWith('ext:claude:abc')
    expect(screen.getByTestId('session-source-pi')).toBeTruthy()
  })
})

describe('statusCaption / relativeTime', () => {
  it('caps subagent captions by count', () => {
    expect(statusCaption({ id: 'a', projectId: 'p', title: 't', provider: 'x', status: 'subagents-running', subagentCount: 1, updatedAt: now })).toBe('子任务中')
    expect(statusCaption({ id: 'a', projectId: 'p', title: 't', provider: 'x', status: 'subagents-running', subagentCount: 2, updatedAt: now })).toBe('2 个子任务')
  })

  it('formats relative time buckets', () => {
    expect(relativeTime(now - 10_000)).toBe('刚刚')
    expect(relativeTime(now - 30 * 60_000)).toBe('30分钟前')
    expect(relativeTime(now - 5 * 3600_000)).toBe('5小时前')
    expect(relativeTime(now - 3 * 86_400_000)).toBe('3天前')
  })

  it('uses relativeTime for completed, interrupted, failed, and idle', () => {
    const updatedAt = now - 12 * 60_000
    const expected = relativeTime(updatedAt)
    for (const status of ['completed', 'interrupted', 'failed', 'idle'] as const) {
      expect(statusCaption({
        id: 'a',
        projectId: 'p',
        title: 't',
        provider: 'x',
        status,
        updatedAt
      })).toBe(expected)
    }
  })

  it('keeps live captions for running and stalled', () => {
    const base = { id: 'a', projectId: 'p', title: 't', provider: 'x', updatedAt: now }
    expect(statusCaption({ ...base, status: 'running' })).toBe('进行中')
    expect(statusCaption({ ...base, status: 'stalled' })).toBe('停滞')
  })
})
