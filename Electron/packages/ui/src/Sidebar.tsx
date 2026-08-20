import { useMemo, useState, type DragEvent } from 'react'
import { ProviderLogo } from './ProviderLogo'
import { SessionSourceIcon } from './SessionSourceIcon'
import { isExternalSidebarSource, sessionRowLabel, sessionSourceLabel, type SessionSource } from './session-source'
import { InlineSessionTitleEditor } from './InlineSessionTitleEditor'
import './sidebar.css'
import gearIcon from './sf-icons/gearshape.png'
import desktopIcon from './sf-icons/desktopcomputer.png'
import qrcodeIcon from './sf-icons/qrcode.png'
import personGroupIcon from './sf-icons/person-2.png'

/** SF Symbols parity footer icons. Rendered from system-exported SF Symbols
 *  bitmaps via CSS mask, so the icon shape matches Swift's `systemName` glyphs
 *  exactly and the color follows `currentColor` (hover states included). */
function FooterIcon({ src, label, ratio }: { src: string; label: string; ratio: number }) {
  // Height ~14px; width follows the glyph's natural aspect ratio.
  return <span className="sb-footer-icon" style={{ width: 14 * ratio, WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }} role="img" aria-label={label} />
}

/** SF Symbols parity sidebar glyphs (folder/folder.fill/ellipsis/plus/pin/pencil/archivebox). */
function SfIconFolder({ filled }: { filled?: boolean }) {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {filled
      ? <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H9l2 2.5h8.5A2.5 2.5 0 0 1 22 8v10.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13Z" />
      : <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H9l2 2.5h8.5A2.5 2.5 0 0 1 22 8v10.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-13Zm2 0v13h15.5V8H10.8L8.8 5.5H4Z" />}
  </svg>
}

function SfIconEllipsis() {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
  </svg>
}

function SfIconPlus() {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function SfIconFolderBadgePlus() {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h4.2l1.8 2h10A1.5 1.5 0 0 1 21.5 8.5v9A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-11Z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
}

function SfIconPin({ filled }: { filled?: boolean }) {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {filled
      ? <path d="M14.2 3.4 20.6 9.8l-1.4 1.4-.7-.7-3.9 3.9v3.8l-1.5 1.5-2.8-2.8-4 4-1.4-1.4 4-4-2.8-2.8 1.5-1.5h3.8l3.9-3.9-.7-.7 1.4-1.4Z" />
      : <path d="M14.2 3.4 20.6 9.8l-1.4 1.4-.7-.7-3.9 3.9v3.8l-1.5 1.5-2.8-2.8-4 4-1.4-1.4 4-4-2.8-2.8 1.5-1.5h3.8l3.9-3.9-.7-.7 1.4-1.4Zm1.4 3.8-7.2 7.2.7.7 7.2-7.2-.7-.7Z" />}
  </svg>
}

function SfIconPencil() {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.6 3.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8 19.9 3.5 21l1.1-4.5L16.6 3.4Zm1.4 2.8-1.2-1.2-1.2 1.2 1.2 1.2 1.2-1.2ZM14.6 7.4l-8.7 8.7.4 1.6 1.6.4 8.7-8.7-2-2Z" />
  </svg>
}

function SfIconArchive() {
  return <svg className="sb-sf-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5V7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 7V5.5ZM4 10h16v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V10Zm5 2a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H9Z" />
  </svg>
}

/**
 * Standalone sidebar for the PipiUI Electron UI — a 1:1 visual/behavior
 * projection of the Swift `SidebarView` (搜索 + 置顶 + 项目分组 + 状态徽标 +
 * 更多分页), deliberately decoupled from the host so the integration worker
 * can mount it later and feed it from real host state.
 *
 * Everything here is **controlled**: the parent owns `expandedIds`,
 * `selectedSessionId`, `searchQuery`, `visibleLimit`, and the data arrays.
 * The component never persists anything (no localStorage, no host calls) —
 * every interaction is reported through a callback.
 */
export type SessionStatus =
  | 'running'
  | 'subagents-running'
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'interrupted'
  | 'idle'

export interface SidebarSession {
  id: string
  projectId: string
  title: string
  provider: string
  modelId?: string
  /** Session origin. Absent/`pi` keeps the live model logo; external sources use dedicated marks. */
  source?: SessionSource
  status: SessionStatus
  /** Running background-subagent count; meaningful only for `subagents-running`. */
  subagentCount?: number
  /** Last-modified epoch ms — rendered as relative time for idle rows. */
  updatedAt: number
}

export interface SidebarProject {
  id: string
  name: string
  path?: string
  sessions: SidebarSession[]
}

export type ProjectMenuAction = 'rename' | 'reveal' | 'remove' | 'newSession'
/** A non-empty reason renders that menu action disabled instead of silently no-oping. */
export type ProjectMenuUnavailable = Partial<Record<ProjectMenuAction, string>>

export interface SidebarProps {
  projects: SidebarProject[]
  pinnedSessions: SidebarSession[]
  /** Archived sessions are global (not per-project), mirroring Swift's archivedSessionsSection. */
  archivedSessions: SidebarSession[]
  /** Project ids whose folder is expanded. Parent-owned (controlled). */
  expandedIds: readonly string[]
  selectedSessionId: string | null
  searchQuery: string
  /** Max project rows rendered before the 更多 control. Parent-owned (controlled). */
  visibleLimit: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onToggleProject: (projectId: string) => void
  onSelectSession: (sessionId: string) => void
  onNewSession: (projectId: string) => void
  /** Menu actions are reported, never applied here (reveal/remove). Rename is inline. */
  onProjectMenu: (projectId: string, action: ProjectMenuAction) => void
  onRenameProject?: (projectId: string, name: string) => Promise<void> | void
  onMoveProject?: (sourceProjectId: string, targetProjectId: string, placement: 'before' | 'after') => void
  /** Move the dragged session into the target session's project. Same-project is a no-op. */
  onMoveSession?: (sessionId: string, targetProjectId: string) => void
  /** Pin the dragged session. Already-pinned is a no-op. */
  onMoveSessionToPinned?: (sessionId: string) => void
  /** Disabled host-backed actions must state why instead of pretending to persist. */
  projectMenuUnavailable?: ProjectMenuUnavailable
  /** Opens the host's native project-folder picker and adds its selection. */
  onAddProject?: () => Promise<boolean>
  projectAddUnavailable?: string
  projectError?: string | null
  onDismissProjectError?: () => void
  onSearch: (query: string) => void
  onShowMore: () => void
  /** Session row hover actions (Swift SessionRowContainer parity). */
  onPinSession?: (sessionId: string) => void
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void
  onArchiveSession?: (sessionId: string) => void
  onUnarchiveSession?: (sessionId: string) => void
  /** Opens the app's settings surface (Swift sidebar footer gear parity). */
  onOpenSettings?: () => void
  onOpenComputerUse?: () => void
  onOpenRemote?: () => void
  onOpenSubagentModels?: () => void
}

/** Swift parity (SidebarView.SessionRowStatus): distinct caption per status. */
export function statusCaption(session: SidebarSession): string {
  switch (session.status) {
    case 'running':
      return '进行中'
    case 'subagents-running':
      return (session.subagentCount ?? 1) > 1 ? `${session.subagentCount} 个子任务` : '子任务中'
    case 'stalled':
      return '停滞'
    case 'completed':
    case 'failed':
    case 'interrupted':
    case 'idle':
      return relativeTime(session.updatedAt)
  }
}

/** 刚刚 / N分钟前 / N小时前 / N天前 — mirrors Swift RelativeDateTimeFormatter. */
export function relativeTime(epochMs: number): string {
  const minutes = Math.floor(Math.max(0, Date.now() - epochMs) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

/** Swift parity (SidebarListLimits.sessions / pageSize): each project folder
 *  starts at 10 visible session rows; one 「更多」 click reveals another 10 until
 *  the whole list is shown, then the toggle reads 「收起」. The shown count is
 *  local component state — never persisted — mirroring Swift's
 *  `sessionsShownByProject`. Project-row pagination (`visibleLimit`) is a
 *  separate, parent-owned concern and stays untouched. */
const SESSION_LIMIT = 10
const SESSION_PAGE_SIZE = 10

/** Mirrors Swift `SidebarListLimits.visiblePrefix`: show a clamped prefix of
 *  `items` (clamped to `[limit, total]`) and report whether the total exceeds
 *  `limit` (governs toggle visibility). */
function visiblePrefix<T>(items: T[], limit: number, shown: number): { items: T[]; showsToggle: boolean } {
  const showsToggle = items.length > limit
  const shownCount = Math.min(Math.max(shown, limit), items.length)
  return { items: items.slice(0, shownCount), showsToggle }
}

/** Decorative per-status glyph (Swift 风格图标). */
function StatusGlyph({ status, count }: { status: SessionStatus; count: number }) {
  if (status === 'running') return <span className="sb-spinner" aria-hidden="true" />
  if (status === 'subagents-running') {
    return (
      <span className="sb-people" aria-hidden="true">
        <svg width="10" height="10" viewBox="0 0 12 12">
          <circle cx="4" cy="4" r="2.1" fill="currentColor" />
          <circle cx="8.6" cy="4" r="2.1" fill="currentColor" opacity="0.72" />
          <path d="M1.2 10.4c.35-2.1 1.5-3.2 2.8-3.2s2.45 1.1 2.8 3.2z" fill="currentColor" />
          <path d="M5.8 10.4c.35-2.1 1.5-3.2 2.8-3.2s2.45 1.1 2.8 3.2z" fill="currentColor" opacity="0.72" />
        </svg>
        {count > 1 && <b className="sb-people-count">{Math.min(count, 9)}</b>}
      </span>
    )
  }
  if (status === 'interrupted') return <span className="sb-ring" aria-hidden="true" />
  if (status === 'idle') return null
  return <span className="sb-dot" aria-hidden="true" />
}

function SessionRow({ session, selected, onSelect, isPinned, onPin, onRename, onArchive, draggable, dragging, dropTarget, onDragStart, onDragEnd, onDragOver, onDrop }: {
  session: SidebarSession
  selected: boolean
  onSelect: (id: string) => void
  isPinned?: boolean
  onPin?: (id: string) => void
  onRename?: (id: string, title: string) => Promise<void> | void
  onArchive?: (id: string) => void
  draggable?: boolean
  dragging?: boolean
  dropTarget?: boolean
  onDragStart?: (event: DragEvent, session: SidebarSession) => void
  onDragEnd?: () => void
  onDragOver?: (event: DragEvent, session: SidebarSession) => void
  onDrop?: (event: DragEvent, session: SidebarSession) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const external = isExternalSidebarSource(session.source)
  const source = session.source ?? 'pi'
  const rowLabel = sessionRowLabel(session.title, source)
  const canPin = !external && onPin
  const canRename = !external && onRename
  const canArchive = !external && onArchive
  const actions = (canPin || canRename || canArchive) ? (
    <span className="sb-session-actions">
      {canPin && <button type="button" className="sb-session-action" aria-label={isPinned ? '取消置顶' : '置顶'} title={isPinned ? '取消置顶' : '置顶'} onClick={event => { event.stopPropagation(); onPin(session.id) }}><SfIconPin filled={isPinned} /></button>}
      {canRename && <button type="button" className="sb-session-action" aria-label="修改标题" title="修改标题" onClick={event => { event.stopPropagation(); setRenaming(true) }}><SfIconPencil /></button>}
      {canArchive && <button type="button" className="sb-session-action" aria-label="归档会话" title="归档会话" onClick={event => { event.stopPropagation(); onArchive(session.id) }}><SfIconArchive /></button>}
    </span>
  ) : null
  return (
    <div
      role="treeitem"
      tabIndex={0}
      className={`sb-session${selected ? ' sb-selected' : ''}`}
      data-testid="session-row"
      data-session-id={session.id}
      data-session-source={source}
      data-status={session.status}
      draggable={renaming || external ? false : draggable}
      data-dragging={dragging || undefined}
      data-drop-target={dropTarget || undefined}
      aria-current={selected ? 'true' : undefined}
      aria-label={rowLabel}
      title={rowLabel}
      onClick={() => { if (!renaming) onSelect(session.id) }}
      onKeyDown={event => { if (!renaming && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(session.id) } }}
      onDragStart={event => { if (!external) onDragStart?.(event, session) }}
      onDragEnd={onDragEnd}
      onDragOver={event => onDragOver?.(event, session)}
      onDrop={event => onDrop?.(event, session)}
    >
      {external
        ? <SessionSourceIcon source={source} size={13} />
        : <span className="sb-session-source" data-source="pi" data-testid="session-source-pi" role="img" aria-label={sessionSourceLabel('pi')} title={sessionSourceLabel('pi')}><ProviderLogo provider={session.provider} modelId={session.modelId} size={13} /></span>}
      {renaming && canRename && onRename
        ? <InlineSessionTitleEditor value={session.title} ariaLabel="会话名称" className="sb-session-title-input" onCommit={async title => { await onRename(session.id, title); setRenaming(false) }} onCancel={() => setRenaming(false)} />
        : <span className="sb-session-title-line">
            <span className="sb-session-title">{session.title}</span>
            {external && <span className="sb-session-external-badge" data-testid="session-external-badge">外部</span>}
          </span>}
      <span className="sb-status" data-status={session.status} aria-label={statusCaption(session)} hidden={renaming}>
        <StatusGlyph status={session.status} count={session.subagentCount ?? 0} />
        <span className="sb-status-text">{statusCaption(session)}</span>
      </span>
      {!renaming && actions}
    </div>
  )
}

/** Active session rows under a project folder, with Swift-parity pagination.
 *  Browse view truncates to `SESSION_LIMIT` (10) with a 「更多/收起」 toggle that
 *  pages 10 at a time; a search bypasses pagination so every match shows. */
function ProjectSessions({ project, query, selectedSessionId, onSelectSession, onPinSession, onRenameSession, onArchiveSession, shown, onToggle, draggedSessionId, sessionDropId, onSessionDragStart, onDragEnd, onSessionDragOver, onSessionDrop }: {
  project: SidebarProject
  query: string
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  onPinSession?: (id: string) => void
  onRenameSession?: (id: string, title: string) => Promise<void> | void
  onArchiveSession?: (id: string) => void
  shown: number
  onToggle: () => void
  draggedSessionId?: string
  sessionDropId?: string | null
  onSessionDragStart?: (event: DragEvent, session: SidebarSession) => void
  onDragEnd?: () => void
  onSessionDragOver?: (event: DragEvent, session: SidebarSession) => void
  onSessionDrop?: (event: DragEvent, session: SidebarSession) => void
}) {
  const sessions = project.sessions
  const isSearch = query !== ''
  const visible = isSearch ? sessions : visiblePrefix(sessions, SESSION_LIMIT, shown).items
  const showsToggle = !isSearch && sessions.length > SESSION_LIMIT
  const collapsed = showsToggle && shown >= sessions.length
  return (
    <div className="sb-project-sessions" role="group" aria-label={`${project.name} 的会话`}>
      {visible.map(session => (
        <SessionRow key={session.id} session={session} selected={selectedSessionId === session.id} onSelect={onSelectSession} onPin={onPinSession} onRename={onRenameSession} onArchive={onArchiveSession} draggable={Boolean(onSessionDragStart)} dragging={draggedSessionId === session.id} dropTarget={sessionDropId === session.id} onDragStart={onSessionDragStart} onDragEnd={onDragEnd} onDragOver={onSessionDragOver} onDrop={onSessionDrop} />
      ))}
      {showsToggle && (
        <button type="button" className="sb-more sb-more-sessions" data-testid="show-more-sessions" aria-label={collapsed ? `收起${project.name} 会话` : `展开更多${project.name} 会话`} onClick={onToggle}>
          {collapsed ? '收起' : '更多'}
        </button>
      )}
    </div>
  )
}

const MENU_ITEMS: { action: ProjectMenuAction; label: string; danger?: boolean }[] = [
  { action: 'rename', label: '重命名' },
  { action: 'reveal', label: '在 Finder 中显示' },
  { action: 'remove', label: '移除项目', danger: true }
]

function ProjectAddControl({ onAddProject, unavailable }: { onAddProject?: () => Promise<boolean>; unavailable?: string }) {
  const [pending, setPending] = useState(false)
  const pick = async () => {
    if (!onAddProject || pending) return
    setPending(true)
    try {
      await onAddProject()
    } finally {
      setPending(false)
    }
  }
  return <button type="button" className="sb-add-project" aria-label="添加项目" title={unavailable ?? '选择项目文件夹'} disabled={Boolean(unavailable) || pending} onClick={() => void pick()}><SfIconFolderBadgePlus /></button>
}

function ProjectRow({ project, isExpanded, onToggle, onNewSession, onProjectMenu, onRenameProject, projectMenuUnavailable, draggable, dragging, dropPlacement, sessionDrop, onDragStart, onDragEnd, onDragOver, onDrop }: {
  project: SidebarProject
  isExpanded: boolean
  onToggle: (id: string) => void
  onNewSession: (id: string) => void
  onProjectMenu: (id: string, action: ProjectMenuAction) => void
  onRenameProject?: (id: string, name: string) => Promise<void> | void
  projectMenuUnavailable?: ProjectMenuUnavailable
  draggable?: boolean
  dragging?: boolean
  dropPlacement?: 'before' | 'after'
  sessionDrop?: boolean
  onDragStart?: (event: DragEvent, project: SidebarProject) => void
  onDragEnd?: () => void
  onDragOver?: (event: DragEvent, project: SidebarProject) => void
  onDrop?: (event: DragEvent, project: SidebarProject) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const runMenuAction = (action: ProjectMenuAction) => {
    setMenuOpen(false)
    if (action === 'rename' && onRenameProject) {
      setRenaming(true)
      return
    }
    onProjectMenu(project.id, action)
  }
  return (
    <div
      className="sb-project"
      role="treeitem"
      aria-expanded={isExpanded}
      data-testid="project-row"
      data-project-id={project.id}
      draggable={renaming ? false : draggable}
      data-dragging={dragging || undefined}
      data-drop-placement={dropPlacement}
      data-session-drop={sessionDrop || undefined}
      onDragStart={event => onDragStart?.(event, project)}
      onDragEnd={onDragEnd}
      onDragOver={event => onDragOver?.(event, project)}
      onDrop={event => onDrop?.(event, project)}
    >
      {renaming && onRenameProject
        ? <div className="sb-project-main">
            <SfIconFolder filled={isExpanded} />
            <InlineSessionTitleEditor
              value={project.name}
              ariaLabel="项目名称"
              className="sb-session-title-input"
              onCommit={async name => { await onRenameProject(project.id, name); setRenaming(false) }}
              onCancel={() => setRenaming(false)}
            />
          </div>
        : <button
            type="button"
            className="sb-project-main"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? '收起' : '展开'}项目 ${project.name}`}
            onClick={() => onToggle(project.id)}
          >
            <SfIconFolder filled={isExpanded} />
            <span className="sb-project-name">{project.name}</span>
          </button>}
      {!renaming && <div className="sb-project-actions">
        <div className="sb-menu-wrap">
          <button
            type="button"
            className="sb-ghost"
            aria-label={`${project.name} 项目菜单`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            title="项目菜单"
            onClick={() => setMenuOpen(open => !open)}
          >
            <SfIconEllipsis />
          </button>
          {menuOpen && (
            <div className="sb-menu" role="menu" aria-label={`${project.name} 项目菜单`} data-testid="project-menu">
              {MENU_ITEMS.map(item => {
                const unavailableReason = projectMenuUnavailable?.[item.action]
                return (
                  <button
                    key={item.action}
                    type="button"
                    role="menuitem"
                    className={`sb-menu-item${item.danger ? ' sb-danger' : ''}`}
                    data-action={item.action}
                    disabled={Boolean(unavailableReason)}
                    title={unavailableReason}
                    onClick={() => runMenuAction(item.action)}
                  >
                    {unavailableReason ? `${item.label}（${unavailableReason}）` : item.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          className="sb-ghost"
          aria-label={`在 ${project.name} 新建会话`}
          title="新建会话"
          onClick={() => onNewSession(project.id)}
        >
          <SfIconPlus />
        </button>
      </div>}
    </div>
  )
}

function ArchivedSection({ sessions, selectedSessionId, onSelect, onUnarchive, offerDrop, dropActive, onDragOver, onDrop }: {
  sessions: SidebarSession[]
  selectedSessionId: string | null
  onSelect: (id: string) => void
  onUnarchive: (id: string) => void
  offerDrop?: boolean
  dropActive?: boolean
  onDragOver?: (event: DragEvent) => void
  onDrop?: (event: DragEvent) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (sessions.length === 0 && !offerDrop) return null
  return (
    <section className="sb-section" aria-label="已归档" data-drop-active={dropActive || undefined} onDragOver={onDragOver} onDrop={onDrop}>
      <button type="button" className="sb-archived-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span className={`sb-archived-chevron${expanded ? ' open' : ''}`} aria-hidden="true">▸</span>
        <span>已归档</span>
        <span className="sb-archived-count">{sessions.length}</span>
      </button>
      {expanded && (
        <div className="sb-archived-list" role="group" aria-label="已归档会话">
          {sessions.map(session => (
            <div className="sb-archived-row" key={session.id}>
              <SessionRow session={session} selected={selectedSessionId === session.id} onSelect={onSelect} />
              <button type="button" className="sb-ghost sb-unarchive" aria-label={`取消归档 ${session.title}`} title="取消归档" onClick={() => onUnarchive(session.id)}>↩</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function Sidebar(props: SidebarProps) {
  const {
    projects,
    pinnedSessions,
    archivedSessions,
    expandedIds,
    selectedSessionId,
    searchQuery,
    visibleLimit,
    collapsed,
    onToggleCollapsed,
    onToggleProject,
    onSelectSession,
    onNewSession,
    onProjectMenu,
    onRenameProject,
    onMoveProject,
    onMoveSession,
    onMoveSessionToPinned,
    projectMenuUnavailable,
    onAddProject,
    projectAddUnavailable,
    projectError,
    onDismissProjectError,
    onSearch,
    onShowMore,
    onPinSession,
    onRenameSession,
    onArchiveSession,
    onUnarchiveSession,
    onOpenSettings,
    onOpenComputerUse,
    onOpenRemote,
    onOpenSubagentModels
  } = props

  const query = searchQuery.trim().toLowerCase()
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds])

  // Per-project session shown counts — local state only, never persisted
  // (Swift parity: `sessionsShownByProject`). Defaults to SESSION_LIMIT (10).
  const [sessionsShownByProject, setSessionsShownByProject] = useState<Record<string, number>>({})
  const [dragged, setDragged] = useState<{ type: 'project' | 'session'; id: string; projectId?: string } | null>(null)
  const [projectDrop, setProjectDrop] = useState<{ id: string; placement: 'before' | 'after' } | null>(null)
  const [sessionDropId, setSessionDropId] = useState<string | null>(null)
  const [sessionProjectDropId, setSessionProjectDropId] = useState<string | null>(null)
  const [archiveDrop, setArchiveDrop] = useState(false)

  const projectPlacementFor = (event: DragEvent): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const finishDrag = () => { setDragged(null); setProjectDrop(null); setSessionDropId(null); setSessionProjectDropId(null); setArchiveDrop(false) }
  const startProjectDrag = (event: DragEvent, project: SidebarProject) => {
    event.dataTransfer?.setData('application/x-pipiui-sidebar-project', project.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    setDragged({ type: 'project', id: project.id })
  }
  const startSessionDrag = (event: DragEvent, session: SidebarSession) => {
    event.stopPropagation()
    event.dataTransfer?.setData('application/x-pipiui-sidebar-session', session.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    setDragged({ type: 'session', id: session.id, projectId: session.projectId })
  }
  const dragOverProject = (event: DragEvent, project: SidebarProject) => {
    if (dragged?.type === 'session') {
      if (dragged.projectId === project.id) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      setSessionProjectDropId(project.id)
      setSessionDropId(null)
      return
    }
    if (dragged?.type !== 'project') return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setProjectDrop({ id: project.id, placement: projectPlacementFor(event) })
  }
  const dropOnProject = (event: DragEvent, project: SidebarProject) => {
    if (dragged?.type === 'session') {
      event.preventDefault()
      if (dragged.projectId !== project.id) onMoveSession?.(dragged.id, project.id)
      finishDrag()
      return
    }
    if (dragged?.type !== 'project') return
    event.preventDefault()
    onMoveProject?.(dragged.id, project.id, projectDrop?.placement ?? 'after')
    finishDrag()
  }
  const dragOverSession = (event: DragEvent, session: SidebarSession) => {
    if (dragged?.type !== 'session') return
    if (dragged.projectId === session.projectId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setSessionDropId(session.id)
  }
  const dropOnSession = (event: DragEvent, session: SidebarSession) => {
    if (dragged?.type !== 'session') return
    event.preventDefault()
    event.stopPropagation()
    if (dragged.projectId !== session.projectId) onMoveSession?.(dragged.id, session.projectId)
    finishDrag()
  }
  const dragOverPinned = (event: DragEvent) => {
    if (dragged?.type !== 'session') return
    if (pinnedSessions.some(session => session.id === dragged.id)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }
  const dropOnPinned = (event: DragEvent) => {
    if (dragged?.type !== 'session') return
    event.preventDefault()
    event.stopPropagation()
    if (!pinnedSessions.some(session => session.id === dragged.id)) onMoveSessionToPinned?.(dragged.id)
    finishDrag()
  }
  const dragOverArchived = (event: DragEvent) => {
    if (dragged?.type !== 'session') return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    setArchiveDrop(true)
  }
  const dropOnArchived = (event: DragEvent) => {
    if (dragged?.type !== 'session') return
    event.preventDefault()
    event.stopPropagation()
    onArchiveSession?.(dragged.id)
    finishDrag()
  }

  // Swift parity (moreToggle): if already fully shown, collapse back to the
  // cap; otherwise reveal another page of 10 (clamped to the total).
  const toggleProjectSessions = (projectId: string, total: number) => {
    setSessionsShownByProject(prev => {
      const current = prev[projectId] ?? SESSION_LIMIT
      if (total > SESSION_LIMIT && current >= total) {
        return { ...prev, [projectId]: SESSION_LIMIT }
      }
      return { ...prev, [projectId]: Math.min(total, current + SESSION_PAGE_SIZE) }
    })
  }

  const sessionMatches = (s: SidebarSession) => {
    if (!query) return true
    return (
      s.title.toLowerCase().includes(query) ||
      s.provider.toLowerCase().includes(query) ||
      (s.modelId ?? '').toLowerCase().includes(query)
    )
  }
  const projectMatches = (p: SidebarProject) =>
    !query || p.name.toLowerCase().includes(query) || (p.path ?? '').toLowerCase().includes(query)

  const visiblePinned = pinnedSessions.filter(sessionMatches)
  // During a search the folder view becomes a results view: every matching
  // project shows its matching sessions regardless of expansion state.
  const isProjectOpen = (id: string) => query !== '' || expanded.has(id)
  const filteredProjects = projects
    .filter(p => projectMatches(p) || p.sessions.some(sessionMatches))
    .map(p => ({ ...p, sessions: query ? p.sessions.filter(sessionMatches) : p.sessions }))

  // Pagination is a search-time bypass: a search result view shows every match,
  // while the browse view truncates to `visibleLimit` (parent owns the count).
  const shownProjects = query ? filteredProjects : filteredProjects.slice(0, visibleLimit)
  const hasMore = !query && filteredProjects.length > visibleLimit

  const noResults = query !== '' && visiblePinned.length === 0 && filteredProjects.length === 0
  const nothingAtAll = query === '' && filteredProjects.length === 0 && pinnedSessions.length === 0

  return (
    <nav className="sb-root" aria-label="会话侧边栏" data-testid="sidebar">
      {!collapsed && (
        <header className="sb-topbar">
          <div className="sb-brand-wordmark" aria-label="PipiUI">Pip<span>i</span> UI</div>
          <button type="button" className="pane-toggle sb-pane-toggle" data-testid="toggle-sidebar" title="收起左栏" aria-label="收起左栏" aria-expanded="true" onClick={onToggleCollapsed}>≡</button>
        </header>
      )}
      <div className="sb-search">
        <span className="sb-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          aria-label="搜索所有会话"
          placeholder="搜索所有会话"
          value={searchQuery}
          onChange={event => onSearch(event.target.value)}
        />
      </div>

      {projectError && <div className="sb-project-error" role="alert" data-testid="sidebar-project-error"><span>{projectError}</span><button type="button" aria-label="关闭项目错误" onClick={onDismissProjectError}>×</button></div>}

      <div className="sb-scroll" role="tree" aria-label="项目与会话">
        {(query ? visiblePinned.length > 0 : true) && (
          <section className="sb-section sb-pinned-section" aria-label="置顶会话" data-drop-active={(dragged?.type === 'session' && !pinnedSessions.some(session => session.id === dragged.id)) || undefined} onDragOver={dragOverPinned} onDrop={dropOnPinned}>
            <h2 className="sb-section-title">置顶</h2>
            {visiblePinned.map(session => (
              <SessionRow key={session.id} session={session} selected={selectedSessionId === session.id} onSelect={onSelectSession} isPinned onPin={onPinSession} onRename={onRenameSession} onArchive={onArchiveSession} draggable={!query && Boolean(onMoveSessionToPinned)} dragging={dragged?.type === 'session' && dragged.id === session.id} onDragStart={startSessionDrag} onDragEnd={finishDrag} onDragOver={dragOverPinned} onDrop={dropOnPinned} />
            ))}
          </section>
        )}

        <section className="sb-section" aria-label="项目">
          <h2 className="sb-section-title sb-project-heading">项目 <ProjectAddControl onAddProject={onAddProject} unavailable={projectAddUnavailable} /></h2>
          {shownProjects.map(project => (
            <div className="sb-project-wrap" key={project.id}>
              <ProjectRow
                project={project}
                isExpanded={isProjectOpen(project.id)}
                onToggle={onToggleProject}
                onNewSession={onNewSession}
                onProjectMenu={onProjectMenu}
                onRenameProject={onRenameProject}
                projectMenuUnavailable={projectMenuUnavailable}
                draggable={!query && Boolean(onMoveProject)}
                dragging={dragged?.type === 'project' && dragged.id === project.id}
                dropPlacement={projectDrop?.id === project.id ? projectDrop.placement : undefined}
                sessionDrop={sessionProjectDropId === project.id}
                onDragStart={startProjectDrag}
                onDragEnd={finishDrag}
                onDragOver={dragOverProject}
                onDrop={dropOnProject}
              />
              {isProjectOpen(project.id) && project.sessions.length > 0 && (
                <ProjectSessions
                  project={project}
                  query={query}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={onSelectSession}
                  onPinSession={onPinSession}
                  onRenameSession={onRenameSession}
                  onArchiveSession={onArchiveSession}
                  shown={sessionsShownByProject[project.id] ?? SESSION_LIMIT}
                  onToggle={() => toggleProjectSessions(project.id, project.sessions.length)}
                  draggedSessionId={dragged?.type === 'session' ? dragged.id : undefined}
                  sessionDropId={sessionDropId}
                  onSessionDragStart={!query && onMoveSession ? startSessionDrag : undefined}
                  onDragEnd={finishDrag}
                  onSessionDragOver={dragOverSession}
                  onSessionDrop={dropOnSession}
                />
              )}
            </div>
          ))}
          {hasMore && (
            <button type="button" className="sb-more" data-testid="show-more" onClick={onShowMore}>
              更多
            </button>
          )}
        </section>

        {!query && onUnarchiveSession && (
          <ArchivedSection sessions={archivedSessions} selectedSessionId={selectedSessionId} onSelect={onSelectSession} onUnarchive={onUnarchiveSession} offerDrop={dragged?.type === 'session'} dropActive={archiveDrop} onDragOver={dragOverArchived} onDrop={dropOnArchived} />
        )}

        {(noResults || nothingAtAll) && (
          <div className="sb-empty" data-testid="sidebar-empty">
            {noResults ? '无匹配结果' : '暂无项目与会话'}
          </div>
        )}
      </div>
      {(onOpenSettings || onOpenComputerUse || onOpenRemote || onOpenSubagentModels) && (
        <footer className="sb-footer" data-testid="sidebar-footer">
          {onOpenSettings && <button type="button" className="sb-footer-btn" aria-label="设置" title="设置" onClick={onOpenSettings}><FooterIcon src={gearIcon} label="设置" ratio={55 / 56} /></button>}
          {onOpenComputerUse && <button type="button" className="sb-footer-btn" aria-label="桌面控制" title="桌面控制" onClick={onOpenComputerUse}><FooterIcon src={desktopIcon} label="桌面控制" ratio={61 / 53} /></button>}
          {onOpenRemote && <button type="button" className="sb-footer-btn" aria-label="远程控制" title="远程控制" onClick={onOpenRemote}><FooterIcon src={qrcodeIcon} label="远程控制" ratio={49 / 49} /></button>}
          {onOpenSubagentModels && <button type="button" className="sb-footer-btn" aria-label="Subagent 模型" title="Subagent 模型" onClick={onOpenSubagentModels}><FooterIcon src={personGroupIcon} label="Subagent 模型" ratio={70 / 49} /></button>}
        </footer>
      )}
    </nav>
  )
}
