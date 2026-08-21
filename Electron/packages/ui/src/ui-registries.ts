import type { ReactNode } from 'react'
import type { Model, ModelState, PipiHostAPI, TerminalSession } from '@pipi/host-api'
import { createContributionRegistry, useRegistrySnapshot, type Disposer } from './contribution-registry'
import type { LiveSubagentProjection } from './live-subagent-projection'
import type { ModelVisibilityController } from './useModelVisibility'
import type { ScanExternalSessionsController } from './useScanExternalSessions'
import type { TranscriptTool } from './transcript-model'
import type { UpdateCenterController } from './useUpdateCenter'
import type { VisionRoutingController } from './useVisionRouting'
import { disposeSlashCommands } from './slash-commands'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'

export { BUILTIN_EXTENSION_ID }
export type { Disposer }

// --- toolRenderers ---------------------------------------------------------

export type ToolRenderProps = {
  tool: TranscriptTool
  streaming?: boolean
  projection?: LiveSubagentProjection
  onOpenSubagents?: (agentId?: string) => void
  elapsed: (startedAt: number, endedAt?: number) => string
  /** Tool result text with a leading `piui:v1` envelope stripped, or the original result. */
  content: string
  /** Structured payload from a `piui:v1` envelope (spec D5). */
  details?: unknown
}

export type ToolRendererContribution = {
  toolName: string
  /** Custom card; `null`/`undefined` falls back to the default TranscriptToolCard. */
  render?: (props: ToolRenderProps) => ReactNode
  summarizeArgs?: (args: Record<string, unknown>) => string
  scrapeSummary?: (text: string) => string | undefined
  /** Running instances project into live subagent rows (subagent / computer_task). */
  liveProjected?: boolean
}

const toolRendererRegistry = createContributionRegistry<ToolRendererContribution>()

export function registerToolRenderer(extId: string, contribution: ToolRendererContribution): Disposer {
  return toolRendererRegistry.register(extId, contribution)
}

export function disposeToolRenderers(extId: string): void {
  toolRendererRegistry.disposeExtension(extId)
}

export function listToolRenderers(): readonly ToolRendererContribution[] {
  return toolRendererRegistry.list()
}

/** Unique tool names in first-seen registration order. */
export function listToolRendererNames(): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of toolRendererRegistry.entries()) {
    if (seen.has(entry.contribution.toolName)) continue
    seen.add(entry.contribution.toolName)
    names.push(entry.contribution.toolName)
  }
  return names
}

/** Last-registered field wins when several contributions share a tool name. */
export function getToolRenderer(toolName: string): ToolRendererContribution | undefined {
  const matches = toolRendererRegistry.entries().filter(entry => entry.contribution.toolName === toolName)
  if (matches.length === 0) return undefined
  return Object.assign({}, ...matches.map(entry => entry.contribution))
}

export function isLiveProjectedTool(toolName: string): boolean {
  return getToolRenderer(toolName)?.liveProjected === true
}

export function useToolRenderers(): readonly ToolRendererContribution[] {
  return useRegistrySnapshot(toolRendererRegistry)
}

// --- settingsSections ------------------------------------------------------

export type SettingsSectionContext = {
  host: PipiHostAPI
  visibility: ModelVisibilityController
  vision: VisionRoutingController
  scan: ScanExternalSessionsController
  updates: UpdateCenterController
  current: Model | null
  onModelState?: (state: ModelState) => void
  onRequestUpdate: (prompt: string) => void
  projectId?: string
  view: 'manage' | 'add'
  setView: (view: 'manage' | 'add') => void
  extensionsAddOpen: boolean
  setExtensionsAddOpen: (open: boolean) => void
}

export type SettingsSectionContribution = {
  id: string
  label: string
  title: string | ((ctx: SettingsSectionContext) => string)
  description: string | ((ctx: SettingsSectionContext) => string)
  onActivate?: (ctx: Pick<SettingsSectionContext, 'setView' | 'setExtensionsAddOpen'>) => void
  headerActions?: (ctx: SettingsSectionContext) => ReactNode
  render: (ctx: SettingsSectionContext) => ReactNode
}

const settingsSectionRegistry = createContributionRegistry<SettingsSectionContribution>()

export function registerSettingsSection(extId: string, contribution: SettingsSectionContribution): Disposer {
  return settingsSectionRegistry.register(extId, contribution)
}

export function disposeSettingsSections(extId: string): void {
  settingsSectionRegistry.disposeExtension(extId)
}

export function listSettingsSections(): readonly SettingsSectionContribution[] {
  return settingsSectionRegistry.list()
}

export function useSettingsSections(): readonly SettingsSectionContribution[] {
  return useRegistrySnapshot(settingsSectionRegistry)
}

export const DEFAULT_SETTINGS_TAB = 'models'

// --- panels ----------------------------------------------------------------

export type PanelTab = string
export const DEFAULT_PANEL_TAB = 'Subagents'

export type PanelRailContext = {
  host: PipiHostAPI
  browserAvailable: boolean | undefined
  terminalAvailable: boolean | undefined
  planTabVisible: boolean
  planProgress: { completed: number; total: number } | null
  subagentsRunningCount: number
}

export type PanelRenderContext = {
  host: PipiHostAPI
  theme: 'light' | 'dark'
  sessionId?: string
  collapsed: boolean
  active: boolean
  headerSlot: HTMLElement | null
  announcedTerminal?: TerminalSession
  revealedTerminalId?: string
  onSubagentsRunningCountChange: (count: number) => void
  onSubagentStarted: () => void
  onManualSubagentStatusCheck: (agentIDs: string[]) => void
  browserAvailable: boolean | undefined
  browserOccluded: boolean
  terminalAvailable: boolean | undefined
  planAvailable: boolean | undefined
  onPlanProgressChange: (progress: { completed: number; total: number } | null) => void
  onHasPlansChange: (sessionId: string, hasPlans: boolean) => void
  retainedWorktreeDispositionAvailable: boolean
  projectId?: string
  projectPath?: string
  openedDocumentPath?: string | null
  onOpenDocument: (path: string) => void
  workspaceFullscreen?: boolean
  onToggleWorkspaceFullscreen?: () => void
}

export type PanelContribution = {
  id: string
  icon: { src: string; ratio: number }
  lazy?: boolean
  visibleInRail?: (ctx: PanelRailContext) => boolean
  /** Return a title when the rail button should be disabled; otherwise enabled. */
  railUnavailable?: (ctx: PanelRailContext) => string | undefined
  railBadge?: (ctx: PanelRailContext) => ReactNode
  render: (ctx: PanelRenderContext) => ReactNode
}

const panelRegistry = createContributionRegistry<PanelContribution>()

export function registerPanel(extId: string, contribution: PanelContribution): Disposer {
  return panelRegistry.register(extId, contribution)
}

export function disposePanels(extId: string): void {
  panelRegistry.disposeExtension(extId)
}

export function listPanels(): readonly PanelContribution[] {
  return panelRegistry.list()
}

export function usePanels(): readonly PanelContribution[] {
  return useRegistrySnapshot(panelRegistry)
}

// --- statusBar (spec D7; first-shell slot may render empty) -----------------

export type StatusBarContribution = {
  id: string
  text?: string
  tooltip?: string
  alignment?: 'left' | 'right'
}

const statusBarRegistry = createContributionRegistry<StatusBarContribution>()

export function registerStatusBarItem(extId: string, contribution: StatusBarContribution): Disposer {
  return statusBarRegistry.register(extId, contribution)
}

export function disposeStatusBarItems(extId: string): void {
  statusBarRegistry.disposeExtension(extId)
}

export function listStatusBarItems(): readonly StatusBarContribution[] {
  return statusBarRegistry.list()
}

export function useStatusBarItems(): readonly StatusBarContribution[] {
  return useRegistrySnapshot(statusBarRegistry)
}

/** Disable = dispose every UI contribution for this extension, zero residue. */
export function disposeUiContributions(extId: string): void {
  disposeSlashCommands(extId)
  disposeToolRenderers(extId)
  disposeSettingsSections(extId)
  disposePanels(extId)
  disposeStatusBarItems(extId)
}
