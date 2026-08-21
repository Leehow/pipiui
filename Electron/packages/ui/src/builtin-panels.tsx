import { BrowserPanel } from './BrowserPanel'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import { DocumentPanel } from './DocumentPanel'
import { PlanPanel } from './PlanPanel'
import { SubagentPanel } from './SubagentPanel'
import { TerminalPanel } from './TerminalPanel'
import { registerPanel } from './ui-registries'
import personGroupIcon from './sf-icons/person-2.png'
import globeIcon from './sf-icons/globe.png'
import docTextIcon from './sf-icons/doc-text.png'
import terminalIcon from './sf-icons/terminal.png'

/** SF Symbols `checklist` traced inline: the rail masks a shape, and a two-row
 *  checklist stays legible at 13px without shipping another bitmap. */
const checklistIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 13"><g fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M.9 3.1 2.5 4.7 5.5 1.3"/><path d="M.9 9.5 2.5 11.1 5.5 7.7"/><path d="M8.2 3.3h7.9"/><path d="M8.2 9.7h7.9"/></g></svg>')}`

registerPanel(BUILTIN_EXTENSION_ID, {
  id: 'Subagents',
  icon: { src: personGroupIcon, ratio: 70 / 49 },
  railBadge: ctx => ctx.subagentsRunningCount > 0
    ? <span className="tool-rail-running" aria-label={`${ctx.subagentsRunningCount} 个运行中的 subagent`}>{ctx.subagentsRunningCount}</span>
    : null,
  render: ctx => (
    <div className="tool-page subagent-content" hidden={!ctx.active}>
      <SubagentPanel
        host={ctx.host}
        sessionId={ctx.sessionId}
        projectPath={ctx.projectPath}
        onOpenDocument={ctx.onOpenDocument}
        retainedWorktreeDispositionAvailable={ctx.retainedWorktreeDispositionAvailable}
        visible={ctx.active && !ctx.collapsed}
        headerSlot={ctx.headerSlot}
        onRunningCountChange={ctx.onSubagentsRunningCountChange}
        onAgentStarted={ctx.onSubagentStarted}
        onManualStatusCheck={ctx.onManualSubagentStatusCheck}
      />
    </div>
  ),
})

registerPanel(BUILTIN_EXTENSION_ID, {
  id: 'Plan',
  icon: { src: checklistIcon, ratio: 17 / 13 },
  visibleInRail: ctx => ctx.planTabVisible,
  railBadge: ctx => ctx.planProgress
    ? <span className="tool-rail-running tool-rail-progress" data-testid="tool-rail-plan-progress" aria-label={`计划进度 ${ctx.planProgress.completed}/${ctx.planProgress.total}`}>{ctx.planProgress.completed}/{ctx.planProgress.total}</span>
    : null,
  render: ctx => ctx.planAvailable === false
    ? (ctx.active
      ? <div className="tool-page"><div className="empty-panel" data-testid="plan-unavailable"><b>Plan 不可用</b><p>当前连接未提供计划能力。</p></div></div>
      : null)
    : (
      <div className="tool-page plan-content" hidden={!ctx.active}>
        <PlanPanel
          host={ctx.host}
          sessionId={ctx.sessionId}
          visible={ctx.active && !ctx.collapsed}
          headerSlot={ctx.headerSlot}
          onProgressChange={ctx.onPlanProgressChange}
          onHasPlansChange={ctx.onHasPlansChange}
        />
      </div>
    ),
})

registerPanel(BUILTIN_EXTENSION_ID, {
  id: 'Browser',
  icon: { src: globeIcon, ratio: 46 / 46 },
  lazy: true,
  railUnavailable: ctx => (ctx.browserAvailable === false || !ctx.host.browser) ? '当前连接不支持内置浏览器' : undefined,
  render: ctx => (
    <div className="tool-page browser-content" hidden={!ctx.active}>
      {ctx.browserAvailable === true && ctx.host.browser
        ? <BrowserPanel
            host={ctx.host}
            sessionId={ctx.sessionId}
            occluded={ctx.browserOccluded || !ctx.active}
            headerSlot={ctx.headerSlot}
            workspaceFullscreen={ctx.workspaceFullscreen}
            onToggleWorkspaceFullscreen={ctx.onToggleWorkspaceFullscreen}
          />
        : <div className="empty-panel browser-placeholder" data-testid="browser-unavailable"><b>Browser 不可用</b><p>{ctx.browserAvailable === undefined ? '正在检查当前连接的浏览器能力…' : '当前连接未提供桌面浏览器能力。'}</p></div>}
    </div>
  ),
})

registerPanel(BUILTIN_EXTENSION_ID, {
  id: 'Document',
  icon: { src: docTextIcon, ratio: 44 / 49 },
  lazy: true,
  render: ctx => (
    <div className="tool-page document-content" hidden={!ctx.active}>
      <DocumentPanel host={ctx.host} documentPath={ctx.openedDocumentPath} />
    </div>
  ),
})

registerPanel(BUILTIN_EXTENSION_ID, {
  id: 'Terminal',
  icon: { src: terminalIcon, ratio: 57 / 43 },
  lazy: true,
  railUnavailable: ctx => (ctx.terminalAvailable === false || !ctx.host.terminal) ? '当前连接不支持终端' : undefined,
  render: ctx => ctx.active && ctx.terminalAvailable === false
    ? <div className="tool-page"><div className="empty-panel" data-testid="terminal-unavailable"><b>Terminal 不可用</b><p>当前连接未提供终端能力。</p></div></div>
    : (
      <div className="tool-page terminal-content" hidden={!ctx.active}>
        <TerminalPanel
          host={ctx.host}
          theme={ctx.theme}
          sessionId={ctx.sessionId}
          announcedTerminal={ctx.announcedTerminal}
          revealedTerminalId={ctx.revealedTerminalId}
          projectId={ctx.projectId}
          projectPath={ctx.projectPath}
          visible={ctx.active}
          headerSlot={ctx.headerSlot}
        />
      </div>
    ),
})
