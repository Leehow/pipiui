import { useMemo, type ReactNode } from 'react'
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
import type { DocumentRendererProps } from '@pipiui/extension-api'
import { disposeWorkbenchContributions } from './workbench/workbench-contributions'
import { useActiveProductExtensions } from './workbench/workbench-runtime'
import { disposeHeaderActions } from './workbench/header-actions'

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
  /** Typed image blocks delivered with the tool result (b64 + mime), if any. */
  images?: { data: string; mimeType: string }[]
}

export type ToolRendererContribution = {
  toolName: string
  /** Custom card; `null`/`undefined` falls back to the default TranscriptToolCard. */
  render?: (props: ToolRenderProps) => ReactNode
  summarizeArgs?: (args: Record<string, unknown>) => string
  scrapeSummary?: (text: string) => string | undefined
  /** Running instances project into live subagent rows. */
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

/** Top-level settings tabs. Extension settings panes stay nested under 扩展. */
export const HOST_SETTINGS_TAB_IDS = ['models', 'extensions', 'updates'] as const

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
  const panels = useRegistrySnapshot(panelRegistry)
  const active = useActiveProductExtensions()
  return useMemo(() => {
    const allowed = new Set(active)
    return panelRegistry.entries()
      .filter(entry => allowed.has(entry.extId))
      .map(entry => entry.contribution)
  }, [panels, active])
}

// --- documentRenderers (contract v1; no capability — the enabled manifest entry is the grant) ---

/** Runtime form of a manifest `app.ui.documentRenderers[]` entry. */
export type DocumentRendererContribution = {
  id: string
  /** Host document kinds claimed by this renderer. */
  kinds?: readonly string[]
  /** File extensions with a leading dot, normalized lowercase. */
  extensions?: readonly string[]
  mimeTypes?: readonly string[]
  /** Higher wins; ties break on id, then extension id — deterministic. */
  priority?: number
  render: (props: DocumentRendererProps) => ReactNode
}

export type RegisteredDocumentRenderer = {
  extId: string
  contribution: DocumentRendererContribution
}

export type DocumentMatchQuery = {
  documentKind?: string
  extension?: string
  mimeType?: string
}

const documentRendererRegistry = createContributionRegistry<DocumentRendererContribution>()

function normalizeMatchExtension(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

/** Deterministic registration errors for invalid declarations and duplicate ids. */
function assertDocumentRenderer(extId: string, contribution: DocumentRendererContribution): void {
  if (!extId || typeof extId !== 'string') {
    throw new Error('document renderer requires a non-empty extension id')
  }
  if (!contribution || typeof contribution !== 'object') {
    throw new Error('document renderer contribution must be an object')
  }
  const id = typeof contribution.id === 'string' ? contribution.id.trim() : ''
  if (!id) throw new Error('document renderer id must be a non-empty string')
  if (typeof contribution.render !== 'function') {
    throw new Error(`document renderer '${id}' must declare a render function`)
  }
  const stringList = (items: readonly string[] | undefined, label: string) => {
    if (items === undefined) return undefined
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error(`document renderer '${id}' ${label} must be non-empty strings`)
    }
    return items.map(item => item.trim()).filter(Boolean)
  }
  const kinds = stringList(contribution.kinds, 'kinds')
  const extensions = stringList(contribution.extensions, 'extensions')?.map(normalizeMatchExtension)
  const mimeTypes = stringList(contribution.mimeTypes, 'mimeTypes')?.map(item => item.toLowerCase())
  if (contribution.priority !== undefined && (typeof contribution.priority !== 'number' || !Number.isFinite(contribution.priority))) {
    throw new Error(`document renderer '${id}' priority must be a finite number`)
  }
  if (!kinds?.length && !extensions?.length && !mimeTypes?.length) {
    throw new Error(`document renderer '${id}' must match kinds, extensions, or mimeTypes`)
  }
}

function normalizeDocumentRenderer(contribution: DocumentRendererContribution): DocumentRendererContribution {
  const normalized: DocumentRendererContribution = { id: contribution.id.trim(), render: contribution.render }
  const kinds = contribution.kinds?.map(kind => kind.trim()).filter(Boolean)
  const extensions = contribution.extensions?.map(normalizeMatchExtension)
  const mimeTypes = contribution.mimeTypes?.map(item => item.trim().toLowerCase()).filter(Boolean)
  if (kinds?.length) normalized.kinds = kinds
  if (extensions?.length) normalized.extensions = extensions
  if (mimeTypes?.length) normalized.mimeTypes = mimeTypes
  if (contribution.priority !== undefined) normalized.priority = contribution.priority
  return normalized
}

/**
 * Register a document renderer. Throws deterministic errors for invalid
 * declarations and for an id already registered by any extension.
 */
export function registerDocumentRenderer(extId: string, contribution: DocumentRendererContribution): Disposer {
  assertDocumentRenderer(extId, contribution)
  const id = contribution.id.trim()
  for (const entry of documentRendererRegistry.entries()) {
    if (entry.contribution.id === id) {
      throw new Error(`document renderer id '${id}' is already registered by extension '${entry.extId}'`)
    }
  }
  return documentRendererRegistry.register(extId, normalizeDocumentRenderer(contribution))
}

export function disposeDocumentRenderers(extId: string): void {
  documentRendererRegistry.disposeExtension(extId)
}

/** Deterministic precedence: priority desc, then id asc, then extension id asc. */
function documentRendererPrecedence(a: RegisteredDocumentRenderer, b: RegisteredDocumentRenderer): number {
  const priorityA = a.contribution.priority ?? 0
  const priorityB = b.contribution.priority ?? 0
  if (priorityA !== priorityB) return priorityB - priorityA
  if (a.contribution.id !== b.contribution.id) return a.contribution.id < b.contribution.id ? -1 : 1
  if (a.extId !== b.extId) return a.extId < b.extId ? -1 : 1
  return 0
}

function registeredDocumentRenderers(): RegisteredDocumentRenderer[] {
  return documentRendererRegistry
    .entries()
    .map(entry => ({ extId: entry.extId, contribution: entry.contribution }))
    .sort(documentRendererPrecedence)
}

/** All registered renderers in deterministic precedence order. */
export function listDocumentRenderers(): readonly RegisteredDocumentRenderer[] {
  return registeredDocumentRenderers()
}

/** Registered document renderers in precedence order; re-renders on registry changes. */
export function useDocumentRenderers(): readonly RegisteredDocumentRenderer[] {
  useRegistrySnapshot(documentRendererRegistry)
  return registeredDocumentRenderers()
}

function documentRendererMatches(contribution: DocumentRendererContribution, query: DocumentMatchQuery): boolean {
  const kind = query.documentKind?.trim()
  if (kind && contribution.kinds?.includes(kind)) return true
  if (query.extension?.trim() && contribution.extensions?.includes(normalizeMatchExtension(query.extension))) {
    return true
  }
  const mime = query.mimeType?.trim().toLowerCase()
  if (mime && contribution.mimeTypes?.includes(mime)) return true
  return false
}

/** Matching renderers for a document, deterministic precedence order. */
export function matchDocumentRenderers(query: DocumentMatchQuery): readonly RegisteredDocumentRenderer[] {
  return registeredDocumentRenderers().filter(entry => documentRendererMatches(entry.contribution, query))
}

/** Best renderer for a document, or undefined (caller keeps builtin rendering). */
export function matchDocumentRenderer(query: DocumentMatchQuery): RegisteredDocumentRenderer | undefined {
  return matchDocumentRenderers(query)[0]
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
  disposeDocumentRenderers(extId)
  disposeStatusBarItems(extId)
  disposeWorkbenchContributions(extId)
  disposeHeaderActions(extId)
}
