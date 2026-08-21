import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { PlanApprovalBar } from './PlanApprovalBar'
import { makeSubagentStatusCheckPrompt } from './subagent-status-check'
import { composerDocumentName, consumeFileDropEvent, DEFAULT_COMPOSER_DOCUMENT_PROMPT, fileDragHasFiles, filterSupportedDocumentPaths, ignoreComposerFileDrag, supportedDocumentPathsFromFiles } from './document-drop'
import './builtin-panels'
import { documentKindForName, resolveThinkingLevel, thinkingLevelsForModel, TRANSPORT_DISCONNECTED } from '@pipi/host-api'
import type { AgentDefinition, AgentSummary, BrowserEvent, BrowserHostAPI, BrowserSnapshot, BrowserTab, BrowserTabsSnapshot, BrowserViewBounds, GitStatus, HistoryEntry, Model, ModelState, PipiHostAPI, PlanSnapshot, Project, PromptAttachment, Session, SessionLease, SidebarSessionPreferences, StreamEvent, SubagentModelSetting, TerminalEvent, TerminalSession, ThinkingLevel } from '@pipi/host-api'
import { ModelVisibilityModal } from './ModelVisibilityModal'
import { ExtensionUiHost } from './ExtensionUiHost'
import { ComputerUsePanel } from './ComputerUsePanel'
import { RemoteConnectionPanel } from './RemoteConnectionPanel'
import { SubagentModelModal } from './SubagentModelModal'
import { ModelQuickMenu } from './ModelQuickMenu'
import { GitBranchMenu } from './GitBranchMenu'
import { ProviderLogo } from './ProviderLogo'
import { Sidebar, type ProjectMenuAction, type ProjectMenuUnavailable, type SidebarProject, type SidebarSession, type SessionStatus } from './Sidebar'
import { canAdoptExternalHistory, externalHistoryToMessages, externalSessionLooksAdoptable, isExternalSessionId, loadExternalSessionsForProjects, replaceProjectExternalSessions, sessionSourceLabel, type ProjectExternalSession } from './session-source'
import { SlashMenu } from './SlashMenu'
import { ThinkingChip } from './thinking-chip'
import type { WaitingPhase } from './WaitingPlaceholder'
import { StreamEventCoalescer } from './StreamEventCoalescer'
import { QuotaPill, QWEN_TOKEN_PLAN_LOGIN_URL } from './QuotaPill'
import { BalancePill } from './BalancePill'
import { SessionStatsPill } from './SessionStatsPill'
import { MessageQueue } from './MessageQueue'
import { useSessionQueue } from './useSessionQueue'
import { InlineSessionTitleEditor } from './InlineSessionTitleEditor'
export { parseSubagentNotice } from './subagent-notice'
import { compactionNotice } from './compaction-notice'
import { filterSlashCommands, parseSlashInvocation, planPromptFromArgs, slashCommandByName, slashPaletteQuery, useSlashCommands, type SlashCommandDef } from './slash-commands'
import { useDeclarativeContributionLoader } from './contribution-loader'
import { DEFAULT_PANEL_TAB, usePanels, type PanelRailContext, type PanelTab } from './ui-registries'
import { useModelVisibility, type ModelVisibilityController } from './useModelVisibility'
import { useVisionRouting, type VisionHostMethods } from './useVisionRouting'
import { useScanExternalSessions } from './useScanExternalSessions'
import { useUpdateCenter } from './useUpdateCenter'
import { chatImagesFromAttachments, fileToPromptAttachment, imageFilesFromClipboard, stripAttachmentPathsForDisplay, validateAttachment } from './attachments'
import { LiveSubagentBindingProvider } from './LiveSubagentBinding'
import { Transcript } from './Transcript'
import { EmptySetupGuide } from './EmptySetupGuide'
import { parseSubagentSignal } from './subagent-signal'
import { appendLiveUserMessage, applySecretRedact, applyStreamEvent, assistantEndedAwaitingModel, assistantLooksSettled, finishStreamingMessage, reopenAssistantForNextCompletion, reconcileHistorySnapshot, transcriptFingerprint, type ChatMessage } from './transcript-model'
import { displaySecretPlaceholders } from './secret-display'
import { toolDisplaySummary } from './tool-summary'
import './app.css'
import './message-actions.css'
import './subagent.css'

type PaneWidths = { sidebar: number; tools: number; browserTools: number; sidebarCollapsed: boolean; toolsCollapsed: boolean }
type SidebarPreferences = { expandedIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; archivedSessionTimestamps?: Record<string, number>; visibleLimit: number }
type SessionWithSidebarMetadata = Session & { provider?: unknown; modelId?: unknown; modelRef?: unknown; model?: unknown }
type RuntimeSessionLease = SessionLease & { canWrite?: unknown; ownerLabel?: unknown }

/** Accept both the current host-api shape and lease payloads from older running Electron hosts.
 *  `null` means the lease has not loaded yet. The composer is already writable in that
 *  state (`leaseReadOnly` only locks after a loaded non-writable lease), so send must
 *  match — otherwise the first click after mount silently no-ops. */
export function leaseCanWrite(lease: SessionLease | null): boolean {
  if (!lease) return true
  const runtime = lease as RuntimeSessionLease
  if (typeof runtime.canWrite === 'boolean') return runtime.canWrite
  return lease.writable === true
}

export function leaseOwnerLabel(lease: SessionLease | null): string {
  if (!lease) return '另一客户端'
  const runtime = lease as RuntimeSessionLease
  if (typeof runtime.ownerLabel === 'string' && runtime.ownerLabel.trim()) return runtime.ownerLabel.trim()
  return lease.holder?.holder || '另一客户端'
}

function initialBrowserToolsWidth(sidebar = 258): number {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  return Math.min(920, Math.max(520, Math.round((viewportWidth - sidebar - 12) * 0.58)))
}
const defaultWidths: PaneWidths = { sidebar: 258, tools: 368, browserTools: initialBrowserToolsWidth(), sidebarCollapsed: false, toolsCollapsed: false }
const storageKey = 'pipiui:eui-pane-widths'
const sidebarPreferencePrefix = 'pipiui:eui:sidebar:v1'
const sidebarSemanticMigrationKey = 'pipiui:eui:sidebar-semantic-host:v1'
export const LAST_SESSION_STORAGE_KEY = 'pipiui:eui:last-session:v1'
const HISTORY_PAGE_SIZE = 500
export const SIDEBAR_PROJECT_PAGE_SIZE = 6
export const ARCHIVE_RETENTION_MS = 24 * 60 * 60 * 1000
const ARCHIVE_CLEANUP_RETRY_MS = 60 * 1000
/** Mock/demo host only: survives browser-demo reloads because the demo has no pi session to own model state. The real host never reads/writes this key. */
export const DEMO_MODEL_STORAGE_KEY = 'pipiui.demoModel'
/** Demo-only per-session model map (sessionId → {provider, id}); the real host binds models per session via JSONL `model_change`, this key only survives browser-demo reloads. */
export const DEMO_SESSION_MODELS_STORAGE_KEY = 'pipiui.demoSessionModels'

/** Workspace scope is derived from project paths; localStorage itself is renderer-profile (user) scoped. */
export function sidebarPreferencesKey(projects: readonly Project[]): string {
  const workspace = projects.map(project => project.path || project.id).sort().join('\u0000') || 'empty-workspace'
  let hash = 2_166_136_261
  for (let index = 0; index < workspace.length; index += 1) {
    hash ^= workspace.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${sidebarPreferencePrefix}:${(hash >>> 0).toString(36)}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function timestampRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
    Boolean(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0
  ))
}

/** Keep only live archive keys; legacy archives start a fresh retention window. */
export function normalizeArchiveTimestamps(archivedSessionIds: readonly string[], timestamps: Record<string, number> | undefined, now = Date.now()): Record<string, number> {
  const source = timestampRecord(timestamps)
  return Object.fromEntries(archivedSessionIds.map(id => [id, source[id] ?? now]))
}

export function expiredArchivedSessionIds(archivedSessionIds: readonly string[], timestamps: Record<string, number>, now = Date.now()): string[] {
  return archivedSessionIds.filter(id => now - timestamps[id] >= ARCHIVE_RETENTION_MS)
}

function isUnknownSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /^unknown session(?:\s|$)/.test(message)
}

function readSidebarPreferences(key: string): SidebarPreferences | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { expandedIds?: unknown; pinnedSessionIds?: unknown; archivedSessionIds?: unknown; archivedSessionTimestamps?: unknown; visibleLimit?: unknown }
    const visibleLimit = typeof candidate.visibleLimit === 'number' && Number.isFinite(candidate.visibleLimit)
      ? Math.max(1, Math.floor(candidate.visibleLimit))
      : SIDEBAR_PROJECT_PAGE_SIZE
    return { expandedIds: stringArray(candidate.expandedIds), pinnedSessionIds: stringArray(candidate.pinnedSessionIds), archivedSessionIds: stringArray(candidate.archivedSessionIds), archivedSessionTimestamps: timestampRecord(candidate.archivedSessionTimestamps), visibleLimit }
  } catch { return null }
}

function writeSidebarPreferences(key: string, preferences: SidebarPreferences) {
  try { localStorage.setItem(key, JSON.stringify(preferences)) } catch { /* storage can be disabled by the host */ }
}

function readLastSessionSelection(): { projectId: string; sessionId: string } | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { projectId?: unknown; sessionId?: unknown }
    return typeof candidate.projectId === 'string' && candidate.projectId && typeof candidate.sessionId === 'string' && candidate.sessionId
      ? { projectId: candidate.projectId, sessionId: candidate.sessionId }
      : null
  } catch {
    try { localStorage.removeItem(LAST_SESSION_STORAGE_KEY) } catch { /* storage can be disabled by the host */ }
    return null
  }
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Read optional future session metadata without widening the host-api v2 contract. */
export function sidebarModelForSession(session: Session, selectedSessionId: string, currentModel: Model | null, knownModels?: Readonly<Record<string, { provider: string; modelId?: string }>>): { provider: string; modelId?: string } {
  // The selected row mirrors the live composer model state: a mid-session model
  // switch updates modelState instantly while the sessions metadata (listSessions
  // snapshot / JSONL model_change) lags, so the live state must win here or the
  // sidebar keeps advertising the pre-switch model.
  if (session.id === selectedSessionId && currentModel) {
    return { provider: currentModel.provider, modelId: currentModel.id }
  }
  const known = knownModels?.[session.id]
  if (known?.provider) return { provider: known.provider, modelId: known.modelId }
  const metadata = session as SessionWithSidebarMetadata
  let provider = metadataString(metadata.provider)
  let modelId = metadataString(metadata.modelId)
  const nested = metadata.model
  if (nested && typeof nested === 'object') {
    const model = nested as { provider?: unknown; id?: unknown; modelId?: unknown }
    provider ??= metadataString(model.provider)
    modelId ??= metadataString(model.id) ?? metadataString(model.modelId)
  }
  const modelRef = metadataString(metadata.modelRef) ?? (typeof nested === 'string' ? metadataString(nested) : undefined)
  if (modelRef) {
    const slash = modelRef.indexOf('/')
    if (slash > 0) {
      provider ??= modelRef.slice(0, slash)
      modelId ??= modelRef.slice(slash + 1) || undefined
    } else modelId ??= modelRef
  }
  return { provider: provider ?? '', modelId }
}

/** Build an immediate display snapshot from listSessions metadata. */
function modelStateFromSession(session: Session | undefined, catalog: readonly Model[]): ModelState | null {
  if (!session) return null
  const ref = sidebarModelForSession(session, '', null)
  if (!ref.provider || !ref.modelId) return null
  const known = catalog.find(model => model.provider === ref.provider && model.id === ref.modelId)
  const model: Model = known ?? { provider: ref.provider, id: ref.modelId, name: ref.modelId }
  return {
    model,
    thinkingLevel: 'off',
    availableThinkingLevels: thinkingLevelsForModel(model)
  }
}

/** Replace provisional/cached session capability data once the authenticated catalog is ready. */
function reconcileModelStateWithCatalog(state: ModelState, catalog: readonly Model[]): ModelState {
  const known = catalog.find(model => model.provider === state.model.provider && model.id === state.model.id)
  if (!known) return state
  return {
    ...state,
    model: known,
    availableThinkingLevels: thinkingLevelsForModel(known, state.availableThinkingLevels)
  }
}

/** Swift-style priority: live activity (selected streaming / observed running / running subagents)
 *  > terminal agent attention badges (failed/stalled/interrupted)
 *  > observed terminal status > completed > idle.
 *  observed is live-updated for every session via `subscribeAllStreams` (older hosts stay selected-only).
 *  A leftover `running` on a non-selected row must not hide a background subagent badge. */
export function sidebarStatusForSession(sessionId: string, selectedSessionId: string, streaming: boolean, observedStatus: SessionStatus | undefined, agents: readonly AgentSummary[]): { status: SessionStatus; subagentCount?: number } {
  const selected = sessionId === selectedSessionId
  if (selected && (streaming || observedStatus === 'running')) return { status: 'running' }
  const linked = agents.filter(agent => agent.sessionId === sessionId)
  const runningCount = linked.filter(agent => agent.state === 'running').length
  if (runningCount > 0) return { status: 'subagents-running', subagentCount: runningCount }
  if (observedStatus === 'running') return { status: 'running' }
  // Selected session: the user is viewing it, so terminal-status notifications
  // (red dot) are consumed — only live activity (running / subagents) stays visible.
  if (selected) return { status: 'idle' }
  if (linked.some(agent => agent.state === 'failed')) return { status: 'failed' }
  if (linked.some(agent => agent.stalled || agent.state === 'stalled')) return { status: 'stalled' }
  if (linked.some(agent => agent.state === 'interrupted' || agent.state === 'aborted')) return { status: 'interrupted' }
  if (observedStatus && observedStatus !== 'idle') return { status: observedStatus }
  if (linked.some(agent => agent.state === 'ok')) return { status: 'completed' }
  return { status: 'idle' }
}

/** Global sidebar snapshot keeps session identity; transcripts receive only the selected slice. */
export function mergeAgentSummary(current: AgentSummary[], incoming: AgentSummary): AgentSummary[] {
  const index = current.findIndex(agent => agent.agentId === incoming.agentId && (
    incoming.sessionId ? agent.sessionId === incoming.sessionId : true
  ))
  const next = index < 0 ? incoming : { ...incoming, sessionId: incoming.sessionId ?? current[index]?.sessionId }
  return index < 0
    ? [...current, next]
    : current.map((agent, candidate) => candidate === index ? next : agent)
}

/** Overlay live agent events on a listAgents snapshot so a stale/empty snapshot cannot drop a running row. */
export function mergeAgentSnapshot(current: AgentSummary[], snapshot: readonly AgentSummary[]): AgentSummary[] {
  return current.reduce((items, agent) => mergeAgentSummary(items, agent), snapshot.slice())
}

export interface SessionSnapshotMergeContext {
  titleRevisionsAtRequest: ReadonlyMap<string, number>
  currentTitleRevisions: ReadonlyMap<string, number>
  retainIds?: ReadonlySet<string>
}

/** Reconcile an authoritative list response without allowing an older request
 *  to roll back newer stream/local metadata already visible in the sidebar.
 *  Equal timestamps are ambiguous, so a response wins only when no title
 *  mutation happened after that exact request began. Without request context,
 *  preserving current remains the fail-safe default. */
export function mergeSessionSnapshot(
  current: readonly Session[],
  snapshot: readonly Session[],
  context?: SessionSnapshotMergeContext,
): Session[] {
  const currentById = new Map(current.map(session => [session.id, session]))
  const merged = snapshot.map(session => {
    const known = currentById.get(session.id)
    if (!known || known.updatedAt < session.updatedAt) return session
    if (known.updatedAt > session.updatedAt) return known
    if (!context) return known
    const requestRevision = context.titleRevisionsAtRequest.get(session.id) ?? 0
    const currentRevision = context.currentTitleRevisions.get(session.id) ?? 0
    return currentRevision > requestRevision ? known : session
  })
  if (!context?.retainIds?.size) return merged
  const listed = new Set(merged.map(session => session.id))
  const retained = current.filter(session => context.retainIds!.has(session.id) && !listed.has(session.id))
  return retained.length ? [...retained, ...merged] : merged
}

export function selectedSessionAgentSummaries(agents: readonly AgentSummary[], sessionId: string): AgentSummary[] {
  return agents.filter(agent => agent.sessionId === sessionId)
}

type SidebarDropPlacement = 'before' | 'after'
const SESSION_ORDER_VERSION = 3 as unknown as NonNullable<SidebarSessionPreferences['sessionOrderVersion']>

function movedIds(ids: string[], sourceId: string, targetId: string, placement: SidebarDropPlacement): string[] {
  if (sourceId === targetId) return ids
  const without = ids.filter(id => id !== sourceId)
  const target = without.indexOf(targetId)
  if (target < 0) return ids
  without.splice(target + (placement === 'after' ? 1 : 0), 0, sourceId)
  return without
}

/** Sessions sort by recency only. Manual drag order was removed in sessionOrderVersion 3. */
export function sessionsByActivityAndManualOrder<T extends Pick<Session, 'id' | 'updatedAt'>>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

function readWidths(): PaneWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '') as Partial<PaneWidths>
    return {
      sidebar: clamp(parsed.sidebar ?? defaultWidths.sidebar, 190, 440),
      tools: clamp(parsed.tools ?? defaultWidths.tools, 270, 620),
      browserTools: clamp(parsed.browserTools ?? initialBrowserToolsWidth(parsed.sidebar ?? defaultWidths.sidebar), 520, 920),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      toolsCollapsed: parsed.toolsCollapsed === true
    }
  } catch { return defaultWidths }
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function elapsed(startedAt: number) { return `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s` }

type MockBrowserTab = BrowserTab & { history: string[]; historyIndex: number }

function mockBrowserURL(value: string): string {
  const input = value.trim()
  if (!input) return ''
  if (/^(about:|file:|https?:\/\/)/i.test(input)) return input
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)) return `http://${input}`
  if (/\s/.test(input) || !input.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  return `https://${input}`
}

function mockBrowserTitle(url: string): string {
  if (!url || url === 'about:blank') return '新标签页'
  try { return new URL(url).hostname || url } catch { return url }
}

function createMockBrowserHost(): BrowserHostAPI {
  let sequence = 0
  let lastBounds: BrowserViewBounds | undefined
  const listeners = new Set<(event: BrowserEvent) => void>()
  // Each chat session owns its own tab space (BrowserTab.partition is the
  // real-world storage partition; the mock mirrors that isolation with a
  // per-session tab list). Events carry the sessionId so the panel can drop
  // tab events from other sessions.
  const spaces = new Map<string, { tabs: MockBrowserTab[]; activeTabId?: string }>()
  const copy = (tab: MockBrowserTab): BrowserTab => {
    const { history: _history, historyIndex: _historyIndex, ...publicTab } = tab
    return { ...publicTab }
  }
  const space = (sessionId: string) => {
    let existing = spaces.get(sessionId)
    if (!existing) {
      const first: MockBrowserTab = { id: `mock-browser-${++sequence}`, title: '新标签页', url: '', isLoading: false, canGoBack: false, canGoForward: false, history: [], historyIndex: -1 }
      existing = { tabs: [first], activeTabId: first.id }
      spaces.set(sessionId, existing)
    }
    return existing
  }
  const state = (sessionId: string): BrowserTabsSnapshot => {
    const target = space(sessionId)
    return { tabs: target.tabs.map(copy), activeTabId: target.activeTabId }
  }
  const emit = (sessionId: string) => listeners.forEach(listener => listener({ type: 'tabs', sessionId, snapshot: state(sessionId) } satisfies BrowserEvent))
  const create = (sessionId: string, url = '') => {
    const target = space(sessionId)
    const tab: MockBrowserTab = { id: `mock-browser-${++sequence}`, title: mockBrowserTitle(url), url, isLoading: false, canGoBack: false, canGoForward: false, history: url ? [url] : [], historyIndex: url ? 0 : -1 }
    target.tabs.push(tab)
    target.activeTabId ??= tab.id
    return tab
  }
  const tabFor = (sessionId: string, id?: string) => {
    const target = space(sessionId)
    const tab = id ? target.tabs.find(item => item.id === id) : target.tabs.find(item => item.id === target.activeTabId)
    if (!tab) throw new Error(`unknown browser tab: ${id ?? target.activeTabId ?? ''}`)
    return tab
  }
  const activate = (sessionId: string, id?: string) => {
    const tab = tabFor(sessionId, id)
    space(sessionId).activeTabId = tab.id
    return tab
  }
  const updateButtons = (tab: MockBrowserTab) => {
    tab.canGoBack = tab.historyIndex > 0
    tab.canGoForward = tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1
  }
  const settle = async (sessionId: string, tab: MockBrowserTab) => {
    tab.isLoading = true
    emit(sessionId)
    await Promise.resolve()
    tab.isLoading = false
    emit(sessionId)
    return copy(tab)
  }
  return {
    selectSession: async sessionId => { void space(sessionId) },
    listTabs: async sessionId => state(sessionId),
    getActiveTab: async sessionId => { const target = space(sessionId); return target.activeTabId ? copy(tabFor(sessionId, target.activeTabId)) : undefined },
    newTab: async (sessionId, options) => {
      const url = options?.url ? mockBrowserURL(options.url) : ''
      const tab = create(sessionId, url)
      space(sessionId).activeTabId = tab.id
      emit(sessionId)
      return copy(tab)
    },
    switchTab: async (sessionId, id) => {
      const tab = activate(sessionId, id)
      emit(sessionId)
      return copy(tab)
    },
    closeTab: async (sessionId, id) => {
      const target = space(sessionId)
      const index = target.tabs.findIndex(tab => tab.id === id)
      if (index < 0) throw new Error(`unknown browser tab: ${id}`)
      const wasActive = target.activeTabId === id
      target.tabs.splice(index, 1)
      if (target.tabs.length === 0) {
        const fresh = create(sessionId)
        target.activeTabId = fresh.id
      } else if (wasActive) {
        target.activeTabId = target.tabs[Math.min(index, target.tabs.length - 1)].id
      }
      emit(sessionId)
      return state(sessionId)
    },
    loadURL: async (sessionId, value, id) => {
      const url = mockBrowserURL(value)
      if (!url) throw new Error('请输入网址或搜索内容。')
      const tab = activate(sessionId, id)
      if (tab.history[tab.historyIndex] !== url) {
        tab.history.splice(tab.historyIndex + 1)
        tab.history.push(url)
        tab.historyIndex = tab.history.length - 1
      }
      tab.url = url
      tab.title = mockBrowserTitle(url)
      updateButtons(tab)
      return settle(sessionId, tab)
    },
    goBack: async (sessionId, id) => {
      const tab = activate(sessionId, id)
      if (tab.historyIndex > 0) {
        tab.historyIndex -= 1
        tab.url = tab.history[tab.historyIndex]
        tab.title = mockBrowserTitle(tab.url)
        updateButtons(tab)
        return settle(sessionId, tab)
      }
      emit(sessionId)
      return copy(tab)
    },
    goForward: async (sessionId, id) => {
      const tab = activate(sessionId, id)
      if (tab.historyIndex < tab.history.length - 1) {
        tab.historyIndex += 1
        tab.url = tab.history[tab.historyIndex]
        tab.title = mockBrowserTitle(tab.url)
        updateButtons(tab)
        return settle(sessionId, tab)
      }
      emit(sessionId)
      return copy(tab)
    },
    reload: async (sessionId, id) => settle(sessionId, activate(sessionId, id)),
    snapshot: async (sessionId, id) => {
      const tab = tabFor(sessionId, id)
      const snapshot: BrowserSnapshot = { tabId: tab.id, url: tab.url, title: tab.title, isLoading: tab.isLoading, text: 'mock browser snapshot' }
      return snapshot
    },
    setViewBounds: async (_sessionId, bounds) => { lastBounds = { ...bounds }; void lastBounds },
    setZoomFactor: async (_sessionId, factor) => {
      const next = Number.isFinite(factor) ? factor : 1
      return Math.min(5, Math.max(0.25, Math.round(next * 100) / 100))
    },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }
  }
}

/** Demo-only persistence of the selected model ({provider, id}); invalid/missing values return null so the caller falls back to the default. */
function readDemoModel(): { provider: string; id: string } | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEMO_MODEL_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { provider?: unknown; id?: unknown }
    const provider = metadataString(candidate.provider)
    const id = metadataString(candidate.id)
    return provider && id ? { provider, id } : null
  } catch { return null }
}

function writeDemoModel(model: Model) {
  try { localStorage.setItem(DEMO_MODEL_STORAGE_KEY, JSON.stringify({ provider: model.provider, id: model.id })) } catch { /* storage can be disabled by the host */ }
}

function readDemoSessionModels(): Record<string, { provider: string; modelId: string }> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DEMO_SESSION_MODELS_STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, { provider: string; modelId: string }> = {}
    for (const [sessionId, raw] of Object.entries(value)) {
      if (!sessionId || !raw || typeof raw !== 'object') continue
      const candidate = raw as { provider?: unknown; id?: unknown }
      const provider = metadataString(candidate.provider)
      const id = metadataString(candidate.id)
      if (provider && id) out[sessionId] = { provider, modelId: id }
    }
    return out
  } catch { return {} }
}

function writeDemoSessionModel(sessionId: string, model: Model) {
  try {
    const all = readDemoSessionModels()
    all[sessionId] = { provider: model.provider, modelId: model.id }
    const storageShape = Object.fromEntries(Object.entries(all).map(([sid, ref]) => [sid, { provider: ref.provider, id: ref.modelId }]))
    localStorage.setItem(DEMO_SESSION_MODELS_STORAGE_KEY, JSON.stringify(storageShape))
  } catch { /* storage can be disabled by the host */ }
}

/** Demo-only plan so the browser preview shows the Plan panel populated. */
function mockPlans(): PlanSnapshot[] {
  const base = Date.now() - 9 * 60_000
  const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString()
  return [{
    id: 'plan-electron-ui',
    title: '让 Electron 前端跟上 plan 运行时',
    lifecycle: 'approved',
    createdAt: at(0),
    approvedAt: at(1),
    updatedAt: at(8),
    active: true,
    tasks: [
      { id: 'contract', title: '在 host-api 里定义 plan 快照与事件通道', state: 'completed' },
      { id: 'store', title: '后端镜像 plan 事件并读回 .pi/plans', state: 'completed', note: '冷会话从磁盘补水一次' },
      { id: 'panel', title: '实现 Plan 面板与进度展示', state: 'in_progress' },
      { id: 'rail', title: '工具栏显示计划进度角标', state: 'pending' },
      { id: 'tests', title: '补面板与后端测试', state: 'pending' }
    ]
  }]
}

/** Local development host; production injects the Electron preload/IPC host. */
export function createMockHost(): PipiHostAPI {
  const projects: Project[] = [
    { id: 'pipiui', name: 'PipiUI', path: '/Users/demo/code/pipiui' },
    { id: 'website', name: 'Website', path: '/Users/demo/code/website' },
    { id: 'design', name: 'Design System', path: '/Users/demo/code/design-system' }
  ]
  const demoSessionModels = readDemoSessionModels()
  const sessions: Session[] = [
    { id: 'welcome', projectId: 'pipiui', name: 'Electron 三栏界面', updatedAt: Date.now(), model: demoSessionModels['welcome'] ?? { provider: 'anthropic', modelId: 'claude-sonnet-4' } },
    { id: 'layout', projectId: 'pipiui', name: '布局与流式消息', updatedAt: Date.now() - 2 * 3_600_000, model: demoSessionModels['layout'] ?? { provider: 'openai', modelId: 'gpt-5' } },
    { id: 'agent-run', projectId: 'pipiui', name: 'Subagent 面板验收', updatedAt: Date.now() - 5 * 60_000, model: demoSessionModels['agent-run'] ?? { provider: 'deepseek', modelId: 'deepseek-v3' } },
    { id: 'tool-burst', projectId: 'pipiui', name: '工具回合合并', updatedAt: Date.now() - 60_000, model: demoSessionModels['tool-burst'] ?? { provider: 'anthropic', modelId: 'claude-sonnet-4' } },
    { id: 'site', projectId: 'website', name: 'Landing page', updatedAt: Date.now() - 86_400_000, model: demoSessionModels['site'] ?? { provider: 'moonshot', modelId: 'moonshot-v8-32k' } },
    { id: 'analytics', projectId: 'website', name: '指标仪表盘', updatedAt: Date.now() - 3 * 86_400_000, model: demoSessionModels['analytics'] ?? { provider: 'xai', modelId: 'grok-4' } },
    // No model data: the row falls back to the neutral logo (unknown) until one is set.
    { id: 'tokens', projectId: 'design', name: '浅色主题 Token', updatedAt: Date.now() - 4 * 3_600_000, model: null }
  ]
  const history: Record<string, HistoryEntry[]> = {
    welcome: [
      { id: 'u1', role: 'user', content: '请实现 Electron 三栏主界面。', timestamp: Date.now() - 60_000 },
      { id: 'a1', role: 'assistant', content: '我会先检查现有结构，然后完成 UI。说明见 [README](README.md)。\n\n```tsx\nexport function App() {\n  return <MainLayout />\n}\n```', timestamp: Date.now() - 50_000 }
    ],
    layout: [{ id: 'u2', role: 'user', content: '左栏宽度要能持久化。', timestamp: Date.now() - 86_400_000 }],
    // pi emits one assistant message per tool round; 6 bash + 1 browser turns
    // must coalesce into a single folded card on resume (tool-cards-collapse).
    'tool-burst': [
      { id: 'tb-u', role: 'user', content: '把目录结构调整成 src 布局，并在浏览器里确认一下。', timestamp: Date.now() - 70_000 },
      { id: 'tb-a1', role: 'assistant', content: '', tools: [{ id: 'tb-call-1', name: 'bash', input: '{"command":"ls -la","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 69_000 },
      { id: 'tb-r1', role: 'tool', content: 'drwxr-xr-x  Sources  Tests  Package.swift', toolCallId: 'tb-call-1', toolName: 'bash', timestamp: Date.now() - 68_000 },
      { id: 'tb-a2', role: 'assistant', content: '', tools: [{ id: 'tb-call-2', name: 'bash', input: '{"command":"mkdir -p Sources/App Sources/Core","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 67_000 },
      { id: 'tb-r2', role: 'tool', content: 'ok', toolCallId: 'tb-call-2', toolName: 'bash', timestamp: Date.now() - 66_000 },
      { id: 'tb-a3', role: 'assistant', content: '', tools: [{ id: 'tb-call-3', name: 'bash', input: '{"command":"git status --short","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 65_000 },
      { id: 'tb-r3', role: 'tool', content: '?? Sources/App/  ?? Sources/Core/', toolCallId: 'tb-call-3', toolName: 'bash', timestamp: Date.now() - 64_000 },
      { id: 'tb-a4', role: 'assistant', content: '', tools: [{ id: 'tb-call-4', name: 'bash', input: '{"command":"swift build","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 63_000 },
      { id: 'tb-r4', role: 'tool', content: 'Build complete! (7.2s)', toolCallId: 'tb-call-4', toolName: 'bash', timestamp: Date.now() - 60_000 },
      { id: 'tb-a5', role: 'assistant', content: '', tools: [{ id: 'tb-call-5', name: 'bash', input: '{"command":"./scripts/build-app.sh --skip-tests","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 59_000 },
      { id: 'tb-r5', role: 'tool', content: '打包完成 → build/PipiUI.app', toolCallId: 'tb-call-5', toolName: 'bash', timestamp: Date.now() - 55_000 },
      { id: 'tb-a6', role: 'assistant', content: '', tools: [{ id: 'tb-call-6', name: 'bash', input: '{"command":"stat -f \"%Sm %N\" build/PipiUI.app/Contents/MacOS/PipiUI","cwd":"/Users/demo/code/pipiui"}' }], timestamp: Date.now() - 54_000 },
      { id: 'tb-r6', role: 'tool', content: '2025-06-12 10:23:11 build/PipiUI.app/Contents/MacOS/PipiUI', toolCallId: 'tb-call-6', toolName: 'bash', timestamp: Date.now() - 53_000 },
      { id: 'tb-a7', role: 'assistant', content: '', tools: [{ id: 'tb-call-7', name: 'browser', input: '{"action":"navigate","url":"http://localhost:5176"}' }], timestamp: Date.now() - 52_000 },
      { id: 'tb-r7', role: 'tool', content: '页面已加载', toolCallId: 'tb-call-7', toolName: 'browser', timestamp: Date.now() - 50_000 },
      { id: 'tb-a8', role: 'assistant', content: '调整完成：src 布局就位，浏览器确认无回归。', timestamp: Date.now() - 49_000 },
    ],
    site: [{ id: 'u3', role: 'user', content: 'Review the landing page.', timestamp: Date.now() - 86_400_000 }]
  }
  const listeners = new Map<string, Set<(event: StreamEvent) => void>>()
  const allStreamListeners = new Set<(event: StreamEvent) => void>()
  // Subagent fixtures are per-session, mirroring the real backend's
  // `filter(agent => !sessionId || agent.sessionId === sessionId)`:
  // switching sessions in the right panel shows that session's own tree.
  const mockAgents: AgentSummary[] = [
    { agentId: 'research', runId: 'mock-1', sessionId: 'welcome', name: 'explore', role: 'explore', title: '调研 UI', task: '调研 Electron UI 结构', state: 'running', depth: 1, createdAt: Date.now() - 20_000, cost: 0.03, costUnit: 'CNY', exchangeRate: 7.2, turns: 2, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', contextTokens: 38_200, contextWindowTokens: 200_000, inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, listSubtitle: '正在梳理右侧面板组件边界' },
    { agentId: 'review', runId: 'mock-2', sessionId: 'welcome', parentId: 'research', name: 'reviewer', role: 'review', title: '检查实现', task: '检查三栏实现', state: 'failed', depth: 2, createdAt: Date.now() - 10_000, endedAt: Date.now() - 2_000, cost: 0.01, costUnit: 'CNY', exchangeRate: 7.2, turns: 1, provider: 'openai', model: 'openai/gpt-5', contextTokens: 9_700, contextWindowTokens: 128_000, inputTokens: 4_200, outputTokens: 970, finalResult: '审查暂未通过：需要补齐右侧 rail 与执行记录的折叠卡对齐。' },
    { agentId: 'ui-check', runId: 'mock-3', sessionId: 'agent-run', name: 'operator', role: 'operator', title: 'UI 验收', task: '验收三栏布局与流式渲染', state: 'ok', depth: 1, createdAt: Date.now() - 30_000, endedAt: Date.now() - 5_000, cost: 0.05, costUnit: 'CNY', exchangeRate: 7.2, turns: 3, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', contextTokens: 24_100, contextWindowTokens: 200_000, inputTokens: 8_300, outputTokens: 1_400, cacheTokens: 3_200, listSubtitle: '截图核对三栏对齐', finalResult: '布局验收通过：三栏对齐、消息流式渲染正常。' },
    { agentId: 'closeout', runId: 'mock-4', sessionId: 'agent-run', name: 'secretary', role: 'secretary', title: '收尾审计', task: '核对 worktree 与残留产物', state: 'ok', depth: 1, createdAt: Date.now() - 15_000, endedAt: Date.now() - 3_000, cost: 0.01, costUnit: 'CNY', exchangeRate: 7.2, turns: 1, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', closeout: '已确认无残留', listSubtitle: '无未合并分支' }
  ]
  // Realistic multi-provider catalog so the picker exercises provider grouping.
  // supportsImages mirrors Swift ModelInfo.supportsImages (deepseek → false).
  let mockModels: Model[] = [
    { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4', reasoning: true, supportsImages: true },
    { provider: 'anthropic', id: 'claude-opus-4-1', name: 'Claude Opus 4.1', reasoning: true, supportsImages: true },
    { provider: 'openai', id: 'gpt-5', name: 'GPT-5', reasoning: true, supportsImages: true },
    { provider: 'openai', id: 'openai-codex', name: 'OpenAI Codex', reasoning: true, supportsImages: false },
    { provider: 'deepseek', id: 'deepseek-v3', name: 'DeepSeek V3', reasoning: false, supportsImages: false },
    { provider: 'moonshot', id: 'moonshot-v8-32k', name: 'Moonshot v8 32k', reasoning: false, supportsImages: false },
    { provider: 'xai', id: 'grok-4', name: 'Grok 4', reasoning: true, supportsImages: true },
    { provider: 'zai', id: 'glm-4v-plus', name: 'GLM-4V-Plus', reasoning: true, supportsImages: true },
    { provider: 'volcengine', id: 'doubao-1-5-pro', name: 'Doubao 1.5 Pro', reasoning: true, supportsImages: true },
    { provider: 'qwen', id: 'qwen-vl-max', name: 'Qwen-VL-Max', reasoning: true, supportsImages: true },
    { provider: 'acme', id: 'mystery-1', name: 'Mystery One', reasoning: false, supportsImages: true }
  ]
  let hiddenModelIds: string[] = []
  let sidebarSessionPreferences: SidebarSessionPreferences = { pinnedSessionIds: [], archivedSessionIds: [], archivedSessionTimestamps: {}, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }
  // Demo-only: restore the reload-persisted model when it is still in the catalog;
  // fall back to mockModels[0] otherwise (real host model state is owned by pi sessions).
  const savedDemoModel = readDemoModel()
  const restoredModel = savedDemoModel ? mockModels.find(model => model.provider === savedDemoModel.provider && model.id === savedDemoModel.id) : undefined
  const initialModel = restoredModel ?? mockModels[0]
  let modelState: ModelState = { model: initialModel, thinkingLevel: 'medium', availableThinkingLevels: thinkingLevelsForModel(initialModel) }
  // Demo-only per-session context occupancy: switching sessions visibly moves
  // the context ring/window in the browser demo (the real host returns live
  // get_session_stats and rehydrates last-known from the token ledger).
  const sessionContextFixtures: Record<string, { tokens: number; window: number }> = {
    welcome: { tokens: 76_000, window: 200_000 },
    layout: { tokens: 40_000, window: 128_000 },
    'agent-run': { tokens: 118_400, window: 200_000 },
    site: { tokens: 12_600, window: 128_000 },
    analytics: { tokens: 203_000, window: 400_000 }
  }
  // Fixture auth metadata (providerId → credential type). Never holds key values.
  let mockAuthCredentials = new Map<string, 'oauth' | 'api_key'>([['anthropic', 'oauth'], ['openai', 'api_key']])
  const mockAuthProviders = [
    { id: 'anthropic', name: 'Anthropic', authTypes: ['oauth', 'api_key'] as const, loginLabel: '登录 Anthropic 账号' },
    { id: 'openai', name: 'OpenAI', authTypes: ['api_key'] as const },
    { id: 'deepseek', name: 'DeepSeek', authTypes: ['api_key'] as const },
    { id: 'github-copilot', name: 'GitHub Copilot', authTypes: ['oauth', 'api_key'] as const, loginLabel: '授权 GitHub 账号' }
  ]
  let loginSeq = 0
  const loginSessions = new Map<string, { providerId: string; authType: 'oauth' | 'api_key'; phase: number }>()
  let computerUseEnabled = false
  let visionEnabled = false
  let visionModel: string | null = null
  let scanExternalSessions = true
  let subagentModels: Record<string, SubagentModelSetting[]> = {}
  let memoryReviewModel: string | null = null
  const agentDefinitions: AgentDefinition[] = [
    { name: 'explore', description: 'Grok-style research agent. Searches the web and the repository, reads, greps, and runs shell, but does not edit files.' },
    { name: 'general-purpose', description: 'Grok-style full-capability worker. Uses an isolated worktree by default; runs directly only when the Boss supplies an explicit reason.' },
    { name: 'reviewer', description: 'Read-only code review specialist for quality and security.' },
    { name: 'computer-use', description: 'Completes one desktop goal in one private Computer Use episode by planning, operating, reconciling, recovering, and verifying without delegation.' },
    { name: 'secretary', description: 'Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree.' },
  ]
  const emit = (sessionId: string, event: StreamEvent) => {
    listeners.get(sessionId)?.forEach(listener => listener(event))
    allStreamListeners.forEach(listener => listener(event))
  }
  const browser = createMockBrowserHost()
  let mockGit: GitStatus = { isRepo: true, currentBranch: 'pipiui/electron-git-branch', isDetached: false, shortSHA: '408cf26', localBranches: ['main', 'pipiui/electron-git-branch', 'pipiui/tunnel-reconnect'], upstream: 'origin/main', ahead: 2, behind: 0, isDirty: true, staged: 1, unstaged: 3, untracked: 2, githubURL: 'https://github.com/demo/pipiui' }
  const mock: PipiHostAPI & VisionHostMethods = {
    protocolVersion: 2,
    listProjects: async () => projects,
    listSessions: async projectId => sessions.filter(session => session.projectId === projectId),
    newSession: async (projectId, name = '新会话') => { const session = { id: crypto.randomUUID(), projectId, name, updatedAt: Date.now() }; sessions.unshift(session); history[session.id] = []; return session },
    resumeSession: async sessionId => sessions.find(session => session.id === sessionId)!,
    renameSession: async (sessionId, name) => {
      const index = sessions.findIndex(session => session.id === sessionId)
      if (index < 0) throw new Error(`unknown session ${sessionId}`)
      sessions[index] = { ...sessions[index], name, updatedAt: Date.now() }
      emit(sessionId, { type: 'session_title', sessionId, title: name, source: 'manual' })
      return sessions[index]
    },
    deleteSession: async () => undefined,
    moveSession: async (sessionId, targetProjectId) => {
      const index = sessions.findIndex(session => session.id === sessionId)
      if (index < 0) throw new Error(`unknown session ${sessionId}`)
      sessions[index] = { ...sessions[index], projectId: targetProjectId }
      return sessions[index]
    },
    getSessionHistory: async sessionId => history[sessionId] ?? [],
    readDocument: async path => {
      const name = path.split('/').at(-1) ?? path
      const kind = documentKindForName(path)
      if (!kind) throw new Error('unsupported document type')
      if (kind === 'markdown') return { id: path, name, path, kind, content: `# ${name}\n\nMock host preview for ${path}.` }
      if (kind === 'plain') return { id: path, name, path, kind, content: `Mock text preview for ${path}.` }
      return { id: path, name, path, kind, bytes: new Uint8Array([1, 2, 3]) }
    },
    getSessionLease: async sessionId => ({ sessionId, writable: true }),
    forceTakeoverSessionLease: async sessionId => ({ sessionId, writable: true }),
    sendPrompt: async (sessionId, prompt, attachments) => {
      const item = { id: crypto.randomUUID(), role: 'user' as const, content: prompt, images: chatImagesFromAttachments(attachments), timestamp: Date.now() }
      ;(history[sessionId] ??= []).push(item)
      emit(sessionId, { type: 'status', sessionId, status: 'started' })
      emit(sessionId, { type: 'thinking', sessionId, contentIndex: 0, delta: '正在分析请求与当前项目结构…' })
      emit(sessionId, { type: 'tool_call', sessionId, toolCallId: 'read-package', name: 'read', delta: 'Electron/packages/ui/package.json' })
      window.setTimeout(() => emit(sessionId, { type: 'tool_result', sessionId, toolCallId: 'read-package', content: '已读取 package.json' }), 350)
      window.setTimeout(() => {
        ;(history[sessionId] ??= []).push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '已开始处理。流式 Markdown 会在完成后使用 Shiki 高亮代码块。',
          thinking: '正在分析请求与当前项目结构…',
          tools: [{ id: 'read-package', name: 'read', input: 'Electron/packages/ui/package.json' }],
          timestamp: Date.now(),
        })
        emit(sessionId, { type: 'text', sessionId, contentIndex: 0, delta: '已开始处理。流式 Markdown 会在完成后使用 Shiki 高亮代码块。' })
      }, 500)
      window.setTimeout(() => emit(sessionId, { type: 'status', sessionId, status: 'settled' }), 750)
    },
    stop: async sessionId => emit(sessionId, { type: 'status', sessionId, status: 'stopped' }),
    queueFollowUp: async () => undefined,
    compact: async sessionId => {
      emit(sessionId, { type: 'compaction', sessionId, phase: 'start', reason: 'manual' })
      await new Promise(resolve => window.setTimeout(resolve, 300))
      emit(sessionId, { type: 'compaction', sessionId, phase: 'end', reason: 'manual' })
    },
    // The Composer still sends directly; queue controls are hosted elsewhere.
    listQueue: async () => [],
    enqueueMessage: async () => { throw new Error('mock queue is unavailable') },
    updateQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    removeQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    promoteQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    steerQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    cutInQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    retryQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    subscribeStream: (sessionId, listener) => { const bucket = listeners.get(sessionId) ?? new Set(); bucket.add(listener); listeners.set(sessionId, bucket); return () => bucket.delete(listener) },
    subscribeAllStreams: listener => { allStreamListeners.add(listener); return () => allStreamListeners.delete(listener) },
    listModels: async () => mockModels,
    getModelState: async sessionId => {
      // Per-session binding, mirroring the real host: each session answers with
      // its own model (JSONL-backed there, fixture/localStorage here).
      if (sessionId) {
        const session = sessions.find(item => item.id === sessionId)
        const ref = session?.model
        if (ref) {
          const found = mockModels.find(model => model.provider === ref.provider && model.id === ref.modelId)
          if (found) return { model: found, thinkingLevel: 'medium', availableThinkingLevels: thinkingLevelsForModel(found) }
        }
      }
      return modelState
    },
    setModel: async (sessionId, provider, id) => {
      if (!sessionId) throw new Error(`unknown session ${sessionId}`)
      const found = mockModels.find(model => model.provider === provider && model.id === id)
      if (!found) throw new Error(`unknown model ${provider}/${id}`)
      modelState = { ...modelState, model: found, availableThinkingLevels: thinkingLevelsForModel(found) }
      // Session-scoped: keep the session's own model in sync so the sidebar row (and
      // future listSessions consumers) shows the same provider the chat uses.
      const target = sessions.find(session => session.id === sessionId)
      if (target) target.model = { provider: found.provider, modelId: found.id }
      writeDemoSessionModel(sessionId, found)
      writeDemoModel(found)
      return modelState
    },
    setThinkingLevel: async (sessionId, level) => {
      if (!sessionId) throw new Error(`unknown session ${sessionId}`)
      modelState = { ...modelState, thinkingLevel: level }
      return modelState
    },
    authProviders: async () => mockAuthProviders.map(p => ({ id: p.id, name: p.name, authTypes: [...p.authTypes], loginLabel: p.loginLabel, authenticated: mockAuthCredentials.has(p.id), authType: mockAuthCredentials.get(p.id) })),
    beginProviderLogin: async (providerId, authType) => {
      const loginId = `mock-login-${++loginSeq}`
      loginSessions.set(loginId, { providerId, authType, phase: 0 })
      return { loginId }
    },
    continueProviderLogin: async (loginId, input) => {
      const session = loginSessions.get(loginId)
      if (!session) return { kind: 'failed', error: '登录会话不存在或已结束' }
      if (session.authType === 'api_key') {
        if (session.phase === 0 && input === undefined) { session.phase = 1; return { kind: 'prompt', promptType: 'secret', message: `输入 ${session.providerId} API Key`, placeholder: 'sk-…' } }
        if (session.phase === 1 && input !== undefined) { session.phase = 2; mockAuthCredentials.set(session.providerId, 'api_key'); return { kind: 'completed', providerId: session.providerId } }
      } else {
        if (session.phase === 0 && input === undefined) { session.phase = 1; return { kind: 'auth_url', url: `https://auth.example.com/${session.providerId}`, code: 'ABCD-1234' } }
        if (session.phase === 1 && input === undefined) { session.phase = 2; mockAuthCredentials.set(session.providerId, 'oauth'); return { kind: 'completed', providerId: session.providerId } }
      }
      return { kind: 'failed', error: 'unexpected login state' }
    },
    cancelProviderLogin: async loginId => { loginSessions.delete(loginId) },
    addOpenAICompatibleProvider: async input => {
      const id = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom-openai'
      mockModels = [...mockModels, { provider: id, id: input.modelId.trim(), name: input.modelId.trim(), reasoning: true }]
      mockAuthCredentials.set(id, 'api_key')
      return { providerId: id }
    },
    removeProviderCredentials: async providerId => {
      mockAuthCredentials.delete(providerId)
      mockModels = mockModels.filter(model => model.provider !== providerId)
      hiddenModelIds = hiddenModelIds.filter(id => !id.startsWith(`${providerId}/`))
      if (modelState.model.provider === providerId) {
        const next = mockModels[0] ?? { provider: 'unknown', id: 'unknown', name: '无可用模型', reasoning: false }
        modelState = { ...modelState, model: next, availableThinkingLevels: thinkingLevelsForModel(next) }
      }
      return modelState
    },
    openExternal: async () => undefined,
    getHiddenModelIds: async () => [...hiddenModelIds],
    setHiddenModelIds: async ids => { hiddenModelIds = [...new Set(ids)].sort(); return [...hiddenModelIds] },
    getSidebarSessionPreferences: async () => ({ pinnedSessionIds: [...sidebarSessionPreferences.pinnedSessionIds], archivedSessionIds: [...sidebarSessionPreferences.archivedSessionIds], archivedSessionTimestamps: { ...(sidebarSessionPreferences.archivedSessionTimestamps ?? {}) }, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }),
    setSidebarSessionPreferences: async preferences => {
      const archived = new Set(preferences.archivedSessionIds)
      const archivedSessionTimestamps = Object.fromEntries(Object.entries(preferences.archivedSessionTimestamps ?? {}).filter(([id]) => archived.has(id)))
      sidebarSessionPreferences = { pinnedSessionIds: [...new Set(preferences.pinnedSessionIds)].filter(id => !archived.has(id)), archivedSessionIds: [...archived], archivedSessionTimestamps, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }
      return { pinnedSessionIds: [...sidebarSessionPreferences.pinnedSessionIds], archivedSessionIds: [...sidebarSessionPreferences.archivedSessionIds], archivedSessionTimestamps: { ...archivedSessionTimestamps }, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }
    },
    getComputerUseState: async () => ({ enabled: computerUseEnabled }),
    setComputerUseEnabled: async enabled => { computerUseEnabled = enabled; return { enabled: computerUseEnabled } },
    checkForUpdates: async () => ({ checkedAt: Date.now(), items: [
      { id: 'pi', name: 'Pi', packageName: '@earendil-works/pi-coding-agent', currentVersion: '0.84.0', latestVersion: '0.84.2', status: 'updateAvailable' },
      { id: 'cua-driver', name: 'Cua Driver', currentVersion: '0.20.0', latestVersion: '0.20.0', status: 'upToDate' }
    ] }),
    getVisionModel: async () => visionModel,
    setVisionModel: async ref => { visionModel = ref; return visionModel },
    getVisionEnabled: async () => visionEnabled,
    setVisionEnabled: async enabled => { visionEnabled = enabled; return visionEnabled },
    getScanExternalSessions: async () => scanExternalSessions,
    setScanExternalSessions: async enabled => { scanExternalSessions = enabled; return scanExternalSessions },
    getSubagentModels: async () => Object.fromEntries(Object.entries(subagentModels).map(([name, chain]) => [name, chain.map(entry => ({ ...entry }))])),
    setSubagentModel: async (agentName, chain) => { if (chain.length) subagentModels[agentName] = chain.map(entry => ({ ...entry })); else delete subagentModels[agentName]; return Object.fromEntries(Object.entries(subagentModels).map(([name, saved]) => [name, saved.map(entry => ({ ...entry }))])) },
    getMemoryReviewModel: async () => memoryReviewModel,
    setMemoryReviewModel: async model => { memoryReviewModel = model; return memoryReviewModel },
    listAgentDefinitions: async () => agentDefinitions.map(agent => ({ ...agent })),
    getSessionStats: async sessionId => {
      const id = sessionId ?? sessions[0]?.id ?? 'mock-session'
      const fixture = sessionContextFixtures[id] ?? { tokens: 0, window: 200_000 }
      const percent = fixture.window > 0 ? Math.min(100, (fixture.tokens / fixture.window) * 100) : 0
      return { sessionId: id, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0, contextUsage: { tokens: fixture.tokens, contextWindow: fixture.window, percent }, model: { provider: modelState.model.provider, id: modelState.model.id, name: modelState.model.name } }
    },
    // Browser/dev fallback fixture: selecting OpenAI Codex exercises the same
    // session/provider-dependent quota UI without an Electron preload; the
    // DeepSeek branch exercises the prepaid-balance capsule (fixture ¥88.00).
    getQuotaSnapshot: async sessionId => {
      // Session-scoped, matching the real host: a sidebar switch must not keep
      // asking the previously selected (or globally configured) model.
      const session = sessionId ? sessions.find(item => item.id === sessionId) : undefined
      const provider = session?.model?.provider ?? modelState.model.provider
      if (provider.includes('openai')) {
        return { provider: 'codex', accountLabel: 'Codex 账号额度', windows: [
          { id: 'primary', usedPercent: 4, label: '5h', title: '5小时额度' },
          { id: 'secondary', usedPercent: 12, label: '周', title: '周额度' }
        ] }
      }
      if (provider === 'deepseek') {
        return { provider: 'deepseek', accountLabel: '账户余额', balance: { amount: 88, currency: 'CNY' }, windows: [] }
      }
      return null
    },
    subscribeSessionStats: () => () => undefined,
    listAgents: async sessionId => mockAgents.filter(agent => !sessionId || agent.sessionId === sessionId),
    // The demo agents have no run behind them, so there is no cached log to replay;
    // subscribeAgentLog below is what populates the panel.
    getAgentLogs: async () => [],
    subscribeAgents: () => () => undefined,
    subscribeAgentLog: (agentId, listener, sessionId, runId) => {
      const selected = mockAgents.find(agent => agent.agentId === agentId && agent.sessionId === sessionId && agent.runId === runId)
      if (!selected || selected.agentId !== 'research') return () => undefined
      const timers: number[] = []
      // Stream cumulative log_delta snapshots (same contentIndex) so the demo shows one
      // progressively-updated row per entry — not a new line per chunk.
      const stream = (contentIndex: number, itemType: 'text' | 'thinking' | 'tool' | 'toolResult', name: string | undefined, chunks: string[]) => {
        let acc = ''
        chunks.forEach((chunk, i) => {
          timers.push(window.setTimeout(() => {
            acc += chunk
            listener({ type: 'agent_log', sessionId, agentId, runId, itemType, text: acc, name, contentIndex })
          }, 300 * (i + 1)))
        })
      }
      stream(0, 'thinking', undefined, ['正在梳理 packages/ui 的组件边界', '，对照 App 与 SubagentPanel 的日志渲染路径…'])
      stream(1, 'tool', 'read', ['Electron/packages/ui/src/App.tsx'])
      stream(2, 'toolResult', undefined, ['已读取主界面实现', '，确认流式更新逻辑位于 SubagentPanel。'])
      return () => timers.forEach(window.clearTimeout)
    },
    abortAgent: async () => undefined, resolveAgent: async () => undefined,
    checkAgent: async agentId => ({ agentId, runId: 'mock', name: 'Mock agent', task: '', state: 'ok' }),
    getWorktreeStatus: async agentId => ({ agentId, lifecycle: 'none', merge: 'unavailable', discard: 'unavailable' }),
    mergeWorktree: async agentId => ({ agentId, lifecycle: 'merged', merge: 'merged', discard: 'unavailable' }),
    discardWorktree: async agentId => ({ agentId, lifecycle: 'discarded', merge: 'unavailable', discard: 'discarded' }),
    getPlans: async sessionId => sessionId ? mockPlans() : [],
    subscribePlans: () => () => undefined,
    capabilities: async () => ({ computerUse: false, revealInFinder: true, terminal: false, documents: true, browser: true, git: true, plan: true, retainedWorktreeDisposition: false }),
    probeGitBinary: async () => true,
    gitStatus: async projectId => projectId === 'pipiui' ? { ...mockGit } : { isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 },
    gitCheckout: async (_projectId, branch) => { mockGit = { ...mockGit, currentBranch: branch, isDetached: false }; return { ...mockGit } },
    revealProject: async () => undefined,
    renameProject: async (projectId, name) => {
      const project = projects.find(item => item.id === projectId)
      if (!project) throw new Error(`unknown project ${projectId}`)
      project.name = name
      return { ...project }
    },
    browser
  }
  return mock
}

/** Hidden-inset macOS chrome only applies inside the Electron shell. */
export function isElectronChrome(): boolean {
  return typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent)
}

function useSystemTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return
    const update = () => setTheme(media.matches ? 'dark' : 'light')
    update(); media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return theme
}

/** Swift parity: below 720pt the sidebar collapses and the right pane becomes an overlay. */
const NARROW_VIEWPORT_QUERY = '(max-width: 720px)'
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => {
    const media = typeof window === 'undefined' ? undefined : window.matchMedia?.(NARROW_VIEWPORT_QUERY)
    return media ? media.matches : false
  })
  useEffect(() => {
    const media = typeof window === 'undefined' ? undefined : window.matchMedia?.(NARROW_VIEWPORT_QUERY)
    // Some test/embedding hosts answer every query from one shared matchMedia
    // stub; only subscribe when the object is really ours.
    if (!media || (media.media && media.media !== NARROW_VIEWPORT_QUERY)) return
    const update = (event: MediaQueryListEvent) => setNarrow(event.matches)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return narrow
}

export function App({ host: injectedHost }: { host?: PipiHostAPI }) {
  const theme = useSystemTheme()
  // Do not allocate a default mock during every render: its changing identity
  // re-ran all host effects on each composer keystroke.
  const mockHost = useRef<PipiHostAPI>()
  const host = injectedHost ?? (mockHost.current ??= createMockHost())
  useDeclarativeContributionLoader(host)
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [externalSessions, setExternalSessions] = useState<ProjectExternalSession[]>([])
  const [externalAdoptableById, setExternalAdoptableById] = useState<Record<string, boolean>>({})
  const [adoptError, setAdoptError] = useState<string | null>(null)
  const [adoptingExternalId, setAdoptingExternalId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedSession, setSelectedSession] = useState('')
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const sessionTitleRevisionByIdRef = useRef(new Map<string, number>())
  const sessionListGenerationByProjectRef = useRef(new Map<string, number>())
  const beginSessionListRequest = useCallback((projectId: string) => {
    const generation = (sessionListGenerationByProjectRef.current.get(projectId) ?? 0) + 1
    sessionListGenerationByProjectRef.current.set(projectId, generation)
    return { generation, titleRevisions: new Map(sessionTitleRevisionByIdRef.current) }
  }, [])
  const isCurrentSessionListRequest = useCallback((projectId: string, generation: number) => (
    sessionListGenerationByProjectRef.current.get(projectId) === generation
  ), [])
  const markSessionTitleMutation = useCallback((sessionId: string) => {
    const revisions = sessionTitleRevisionByIdRef.current
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1)
  }, [])
  const selectedProjectRef = useRef(selectedProject)
  selectedProjectRef.current = selectedProject
  const selectedSessionRef = useRef(selectedSession)
  selectedSessionRef.current = selectedSession
  const restoredLastSessionRef = useRef(false)
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [modelState, setModelState] = useState<ModelState | null>(null)
  const modelStatesBySessionRef = useRef(new Map<string, ModelState>())
  const modelWriteGenRef = useRef(0)
  const [sessionModels, setSessionModels] = useState<Record<string, { provider: string; modelId?: string }>>({})
  const rememberSessionModel = (sessionId: string, model: Model) => {
    if (!sessionId || !model.provider || !model.id) return
    setSessionModels(current => {
      const previous = current[sessionId]
      if (previous?.provider === model.provider && previous.modelId === model.id) return current
      return { ...current, [sessionId]: { provider: model.provider, modelId: model.id } }
    })
  }
  const draftsBySessionRef = useRef(new Map<string, string>())
  /** Unsent composer image attachments per session; cleared on send or when the list empties. */
  const attachmentsBySessionRef = useRef(new Map<string, ComposerAttachment[]>())
  /** Unsent composer document chips per session; cleared on send or when the list empties. */
  const documentsBySessionRef = useRef(new Map<string, ComposerDocument[]>())
  const [streaming, setStreaming] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null)
  const [waitingVisible, setWaitingVisible] = useState(false)
  const [waitingPhase, setWaitingPhase] = useState<WaitingPhase>('awaiting')
  const [waitingDetail, setWaitingDetail] = useState<string | undefined>(undefined)
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null)
  const [stopError, setStopError] = useState<{ sessionId: string; message: string } | null>(null)
  const [lease, setLease] = useState<SessionLease | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>(DEFAULT_PANEL_TAB)
  const [toolReturnTab, setToolReturnTab] = useState<PanelTab | null>(null)
  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab
  const activeTabBySessionRef = useRef<Record<string, PanelTab>>({})
  const applyActiveTab = useCallback((tab: PanelTab) => {
    const sessionId = selectedSessionRef.current
    if (sessionId) activeTabBySessionRef.current[sessionId] = tab
    setActiveTab(tab)
  }, [])
  const rememberToolReturn = useCallback((tab: PanelTab) => {
    const current = activeTabRef.current
    if (tab !== current) setToolReturnTab(tab === 'Subagents' ? null : current)
    applyActiveTab(tab)
  }, [applyActiveTab])
  // Keyed by session like the terminals: the right panel belongs to one
  // conversation, so switching sessions must not leave the previous session's
  // document open in the reader.
  const [openedDocumentPaths, setOpenedDocumentPaths] = useState<Record<string, string>>({})
  const [announcedTerminals, setAnnouncedTerminals] = useState<Record<string, TerminalSession>>({})
  const [revealedTerminalIds, setRevealedTerminalIds] = useState<Record<string, string>>({})
  const [widths, setWidths] = useState<PaneWidths>(readWidths)
  const narrowViewport = useNarrowViewport()
  // Narrow-viewport override (not persisted): both panes start collapsed and the
  // header toggles / quick rail flip these to show the panes as overlays.
  const [narrowPanes, setNarrowPanes] = useState<{ sidebar: boolean; tools: boolean }>({ sidebar: false, tools: false })
  const [subagentsRunningCount, setSubagentsRunningCount] = useState(0)
  const subagentRunEpochRef = useRef({ sessionId: '', count: 0, turnEpoch: 0 })
  /** Turn-start anchor for the background-subagent tail indicator (phase=tool, no stop). */
  const [subagentWaitingStartedAt, setSubagentWaitingStartedAt] = useState<number | null>(null)
  const [sidebarExpandedIds, setSidebarExpandedIds] = useState<string[]>([])
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>([])
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([])
  const [archivedSessionTimestamps, setArchivedSessionTimestamps] = useState<Record<string, number>>({})

  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_PROJECT_PAGE_SIZE)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [sidebarAgents, setSidebarAgents] = useState<AgentSummary[]>([])
  // Latest committed transcript for the stream effect's first-response-wait
  // decisions. Read via ref so the subscription closure never goes stale (that
  // effect does not re-run per message).
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages
  const messagesBySessionRef = useRef(new Map<string, ChatMessage[]>())
  const historyCompleteBySessionRef = useRef(new Map<string, boolean>())
  const historyFingerprintBySessionRef = useRef(new Map<string, string>())
  const locallyCreatedSessionIdsRef = useRef(new Set<string>())
  const skippedInitialEmptyHistoryRef = useRef(new Set<string>())
  const transcriptLiveRevisionRef = useRef(0)
  const mutateLocalTranscript = useCallback((mutation: (current: ChatMessage[]) => ChatMessage[]) => {
    const current = messagesRef.current
    const next = mutation(current)
    if (next === current) return current
    transcriptLiveRevisionRef.current += 1
    messagesRef.current = next
    const sessionId = selectedSessionRef.current
    if (sessionId) messagesBySessionRef.current.set(sessionId, next)
    setMessages(next)
    return next
  }, [])
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>([])
  useEffect(() => {
    if (selectedSession && messagesBySessionRef.current.has(selectedSession)) {
      messagesBySessionRef.current.set(selectedSession, messages)
    }
  }, [selectedSession, messages])
  useEffect(() => {
    if (!selectedSession) return
    setMountedSessionIds(current => {
      if (current[0] === selectedSession) return current
      return [selectedSession, ...current.filter(id => id !== selectedSession)].slice(0, 6)
    })
  }, [selectedSession])
  const [hasPlansBySession, setHasPlansBySession] = useState<Record<string, boolean>>({})
  const handleHasPlansChange = useCallback((sessionId: string, hasPlans: boolean) => {
    setHasPlansBySession(current => current[sessionId] === hasPlans ? current : { ...current, [sessionId]: hasPlans })
  }, [])
  const selectedHasPlans = selectedSession ? hasPlansBySession[selectedSession] === true : false
  useEffect(() => {
    if (!selectedSession) return
    const remembered = activeTabBySessionRef.current[selectedSession] ?? DEFAULT_PANEL_TAB
    // When the last live plan settles, drop the Plan tab and leave the page so
    // the user is not stranded on a hidden/blank Plan surface.
    if ((remembered === 'Plan' || activeTabRef.current === 'Plan') && !selectedHasPlans) {
      setToolReturnTab(current => current === 'Plan' ? null : current)
      applyActiveTab(DEFAULT_PANEL_TAB)
      return
    }
    setActiveTab(remembered)
  }, [applyActiveTab, selectedSession, selectedHasPlans])
  const [observedSessionStatuses, setObservedSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [loadedSidebarPreferencesKey, setLoadedSidebarPreferencesKey] = useState('')
  const [canRevealInFinder, setCanRevealInFinder] = useState(false)
  const [gitAvailable, setGitAvailable] = useState(false)
  const [browserAvailable, setBrowserAvailable] = useState<boolean | undefined>(host.browser ? undefined : false)
  const [browserWorkspaceFullscreen, setBrowserWorkspaceFullscreen] = useState(false)
  useEffect(() => {
    if (activeTab !== 'Browser') setBrowserWorkspaceFullscreen(false)
  }, [activeTab])
  const [terminalAvailable, setTerminalAvailable] = useState<boolean | undefined>(host.terminal ? undefined : false)
  const [retainedWorktreeDispositionAvailable, setRetainedWorktreeDispositionAvailable] = useState(false)
  const [planAvailable, setPlanAvailable] = useState<boolean | undefined>(host.getPlans ? undefined : false)
  const planTabVisible = planAvailable !== false && Boolean(host.getPlans) && selectedHasPlans
  const [planProgressBadge, setPlanProgressBadge] = useState<{ completed: number; total: number } | null>(null)
  const [computerUseAvailable, setComputerUseAvailable] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalInitialView, setModalInitialView] = useState<'manage' | 'add'>('manage')
  const [gitBinary, setGitBinary] = useState<boolean | 'unknown'>('unknown')
  const vision = useVisionRouting(host)
  const scanExternal = useScanExternalSessions(host)
  const scanExternalRef = useRef(scanExternal)
  scanExternalRef.current = scanExternal
  const updates = useUpdateCenter(host)
  // Opening the settings modal refreshes the vision-routing snapshot so the 通用
  // tab always shows the host's current state (reads happen on open, per spec).
  const openModelManager = () => { setModalInitialView('manage'); setModalOpen(true); void vision.refresh(); void scanExternal.refresh() }
  const openAddProvider = () => { setModalInitialView('add'); setModalOpen(true); void vision.refresh(); void scanExternal.refresh() }
  const closeModelManager = () => setModalOpen(false)
  const [computerUseOpen, setComputerUseOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [subagentModelsOpen, setSubagentModelsOpen] = useState(false)
  const browserOccluded = modalOpen || computerUseOpen || remoteOpen || subagentModelsOpen
  const modalVisibility = useModelVisibility(host, modelState?.model)
  const copiedTimerRef = useRef<number | null>(null)
  const archiveCleanupInFlightRef = useRef(new Set<string>())
  const sidebarStorageKey = useMemo(() => sidebarPreferencesKey(projects), [projects])
  // Any active main turn — a local send, a host-driven/resumed/read-only turn, or a
  // queue dispatch — owns the waiting placeholder from `started` until
  // `settled`/`stopped`. The ref is a same-tick guard so repeated started
  // status events keep the first waitingStartedAt stable.
  const activeUserTurnRef = useRef(false)
  // Monotonic renderer-local generation for the selected main turn. Terminal
  // subagent projection may be the only close signal we receive; binding its
  // reconciliation to this epoch prevents a late prior-task terminal from
  // closing a newer prompt.
  const mainTurnEpochRef = useRef(0)
  // True only between an authoritative `started` and `settled`/`stopped`.
  // A late `streaming` (pi queue_update after settle) must not reopen the turn.
  const mainTurnOpenRef = useRef(false)
  // Set on settled/stopped. A bare `started` with no new prompt after this is a
  // ghost turn (JSONL already idle). Real follow-ups advance the host epoch or
  // carry pendingFollowUps/a new user row and still open the wait.
  const turnJustSettledRef = useRef(false)
  /** Host `turnEpoch` of the started turn now shown as live. A later
   *  `settled`/`stopped` from an older epoch is the previous empty-stop
   *  reconciliation and must not freeze the silent next hop. */
  const openedTurnEpochBySessionRef = useRef(new Map<string, number>())
  /** The optimistic user bubble of the in-flight direct send. The server's
   *  `user_message` echo merges back into this bubble by id, so an assistant
   *  placeholder that already streamed past it cannot wedge a duplicate below. */
  const pendingLocalUserRef = useRef<{ id: string; content: string } | null>(null)
  const stoppingSessionRef = useRef<string | null>(null)
  const historyLoadRef = useRef(0)
  const historyContextRef = useRef<{ host: PipiHostAPI; sessionId: string } | null>(null)
  /** Send from the empty "新会话" state creates the session first; the pending
   *  prompt is dispatched by the auto-send effect once the new session's history
   *  load and stream subscription are live (a direct sendPrompt would race them). */
  const pendingAutoSendRef = useRef<{ sessionId: string; prompt: string; attachments?: ComposerAttachment[]; documents?: ComposerDocument[] } | null>(null)
  // Mirror of observedSessionStatuses for the history-load effect. Adding the map
  // itself to that effect's deps would re-load history on every status event.
  const observedSessionStatusesRef = useRef(observedSessionStatuses)
  useEffect(() => { observedSessionStatusesRef.current = observedSessionStatuses }, [observedSessionStatuses])
  const applyObservedStatus = useCallback((sessionId: string, status: SessionStatus) => {
    if (observedSessionStatusesRef.current[sessionId] === status) return
    observedSessionStatusesRef.current = { ...observedSessionStatusesRef.current, [sessionId]: status }
    setObservedSessionStatuses(current => current[sessionId] === status ? current : { ...current, [sessionId]: status })
  }, [])
  // Anchor the subagent tail indicator on the first 0→>0 transition of the selected
  // session's running count. SubagentPanel clears its agents on session switch (the
  // count dips to 0), which resets the anchor so the elapsed clock never carries over
  // from the previous session; later count changes inside a run keep the anchor.
  useEffect(() => {
    if (subagentsRunningCount > 0) setSubagentWaitingStartedAt(current => current ?? Date.now())
    else setSubagentWaitingStartedAt(null)
  }, [subagentsRunningCount])
  useEffect(() => {
    const previous = subagentRunEpochRef.current
    if (previous.sessionId !== selectedSession) {
      subagentRunEpochRef.current = { sessionId: selectedSession, count: subagentsRunningCount, turnEpoch: mainTurnEpochRef.current }
      return
    }
    if (previous.count === 0 && subagentsRunningCount > 0) {
      subagentRunEpochRef.current = { sessionId: selectedSession, count: subagentsRunningCount, turnEpoch: mainTurnEpochRef.current }
      return
    }
    subagentRunEpochRef.current = { ...previous, count: subagentsRunningCount }
    if (
      previous.count > 0
      && subagentsRunningCount === 0
      && previous.turnEpoch === mainTurnEpochRef.current
      && mainTurnOpenRef.current
    ) {
      // A Computer Task can durably settle all of its agents even when the
      // selected main-stream `settled` event is lost. Re-read the authoritative
      // JSONL; the existing history/live-revision gates decide whether this
      // exact turn is terminal and refuse to close a newer one.
      setHistoryRefreshKey(key => key + 1)
    }
  }, [selectedSession, subagentsRunningCount])
  const sessionQueue = useSessionQueue(host, isExternalSessionId(selectedSession) ? '' : selectedSession, streaming)
  const selectedObservedStatus = observedSessionStatuses[selectedSession]
  const selectedObservedRunning = selectedObservedStatus === 'running'
  const selectedObservedClosed = selectedObservedStatus === 'completed' || selectedObservedStatus === 'interrupted'
  const messageStreaming = messages.some(message => message.role === 'assistant' && message.streaming)
  const selectedStopping = stoppingSessionId === selectedSession
  // A leftover sending queue item after settle/stop must not keep the composer
  // locked. Host stop is authoritative; `sending` is only meaningful while the
  // turn is still open.
  const queueLocksComposer = sessionQueue.busy && !selectedObservedClosed
  // A leftover streaming assistant after settle (late text/tool) must not keep
  // the stop button once the authoritative turn is already closed.
  const sessionWorking = streaming || selectedObservedRunning || (messageStreaming && !selectedObservedClosed) || queueLocksComposer || compacting || selectedStopping
  const closeOpenTurn = useCallback((sessionId: string, status: 'completed' | 'interrupted', options?: { keepStopGuard?: boolean }) => {
    applyObservedStatus(sessionId, status)
    if (!options?.keepStopGuard && stoppingSessionRef.current === sessionId) stoppingSessionRef.current = null
    setStoppingSessionId(current => current === sessionId ? null : current)
    setStopError(current => current?.sessionId === sessionId ? null : current)
    if (selectedSessionRef.current !== sessionId) return
    mainTurnOpenRef.current = false
    turnJustSettledRef.current = true
    pendingLocalUserRef.current = null
    setStreaming(false)
    setCompacting(false)
    setStatsRefreshKey(key => key + 1)
    void sessionQueue.resync()
    transcriptLiveRevisionRef.current += 1
    const next = finishStreamingMessage(messagesRef.current)
    messagesRef.current = next
    setMessages(next)
    activeUserTurnRef.current = false
    setWaitingVisible(false)
    setWaitingStartedAt(null)
    setWaitingDetail(undefined)
  }, [applyObservedStatus, sessionQueue])
  const closeOpenTurnRef = useRef(closeOpenTurn)
  closeOpenTurnRef.current = closeOpenTurn
  const canWriteLease = leaseCanWrite(lease)
  const isExternalSelected = isExternalSessionId(selectedSession)
  const leaseReadOnly = isExternalSelected || (lease !== null && !canWriteLease)
  const leaseConflictError = sessionQueue.items.find(item =>
    item.status === 'failed' && typeof item.error === 'string' && item.error.includes('session is read-only'),
  )?.error
  /** The explicit path read performs the one-time backend migration; listProjects supplies matching UI metadata. */
  const refreshProjects = useCallback(async () => {
    const paths = host.getProjectPaths ? await host.getProjectPaths() : undefined
    const listed = await host.listProjects()
    const explicitPaths = paths ? new Set(paths) : undefined
    const items = explicitPaths ? listed.filter(project => explicitPaths.has(project.path)) : listed
    const groupedSessions = await Promise.all(items.map(async project => {
      const request = beginSessionListRequest(project.id)
      try {
        return { projectId: project.id, sessions: await host.listSessions(project.id), ...request }
      } catch (error) {
        return { projectId: project.id, error, ...request }
      }
    }))
    const titleRevisionsAtRequest = new Map<string, number>()
    const listedSessions: Session[] = groupedSessions.flatMap(result => {
      if ('error' in result || !isCurrentSessionListRequest(result.projectId, result.generation)) {
        return sessionsRef.current.filter(session => session.projectId === result.projectId)
      }
      result.titleRevisions.forEach((revision, sessionId) => titleRevisionsAtRequest.set(sessionId, revision))
      return result.sessions
    })
    const retainIds = new Set(locallyCreatedSessionIdsRef.current)
    if (selectedSessionRef.current) retainIds.add(selectedSessionRef.current)
    const nextSessions = mergeSessionSnapshot(sessionsRef.current, listedSessions, {
      titleRevisionsAtRequest,
      currentTitleRevisions: sessionTitleRevisionByIdRef.current,
      retainIds,
    })
    const failures = groupedSessions.flatMap(result => 'error' in result ? [result] : [])
    if (failures.length) {
      const details = failures.map(({ projectId, error }) => `${items.find(project => project.id === projectId)?.name ?? projectId}：${error instanceof Error ? error.message : String(error)}`).join('；')
      setProjectError(`加载会话列表失败：${details}`)
    }
    const validProjectIds = new Set(items.map(project => project.id))
    const remembered = restoredLastSessionRef.current ? null : readLastSessionSelection()
    restoredLastSessionRef.current = true
    const pickWorkspace = (listedExternal: ProjectExternalSession[]) => {
      const validSessionIds = new Set([...nextSessions.map(session => session.id), ...listedExternal.map(session => session.id)])
      const rememberedPi = remembered && validProjectIds.has(remembered.projectId)
        ? nextSessions.find(session => session.id === remembered.sessionId && session.projectId === remembered.projectId)
        : undefined
      const rememberedExternal = remembered && validProjectIds.has(remembered.projectId)
        ? listedExternal.find(session => session.id === remembered.sessionId && session.projectId === remembered.projectId)
        : undefined
      const currentPi = nextSessions.find(session => session.id === selectedSessionRef.current)
      const currentExternal = listedExternal.find(session => session.id === selectedSessionRef.current)
      const nextSession = currentPi ?? currentExternal ?? rememberedPi ?? rememberedExternal ?? nextSessions[0]
      const nextProject = nextSession && 'projectId' in nextSession && nextSession.projectId
        ? nextSession.projectId
        : (validProjectIds.has(selectedProjectRef.current) ? selectedProjectRef.current : items[0]?.id ?? '')
      return {
        projectId: nextProject,
        sessionId: validSessionIds.has(nextSession?.id ?? '') ? nextSession!.id : '',
      }
    }
    const first = pickWorkspace([])
    setProjects(items)
    setSessions(nextSessions)
    setSelectedProject(first.projectId)
    setSelectedSession(first.sessionId)
    setProjectsLoaded(true)
    const scan = scanExternalRef.current
    const listedExternal = !scan.loading && scan.enabled
      ? await loadExternalSessionsForProjects(host.listExternalSessions, items)
      : []
    setExternalSessions(listedExternal)
    const selectedNow = selectedSessionRef.current
    const rememberedExternal = remembered && validProjectIds.has(remembered.projectId)
      ? listedExternal.find(session => session.id === remembered.sessionId && session.projectId === remembered.projectId)
      : undefined
    if (rememberedExternal && (!selectedNow || selectedNow === first.sessionId)) {
      setSelectedProject(rememberedExternal.projectId)
      setSelectedSession(rememberedExternal.id)
    }
    return items
  }, [beginSessionListRequest, host, isCurrentSessionListRequest])

  useEffect(() => { void refreshProjects().catch(error => setProjectError(`加载项目失败：${error instanceof Error ? error.message : String(error)}`)); void host.capabilities().then(capabilities => { setCanRevealInFinder(capabilities.revealInFinder && typeof host.revealProject === 'function'); setBrowserAvailable(Boolean(capabilities.browser && host.browser)); setTerminalAvailable(Boolean(capabilities.terminal && host.terminal)); setGitAvailable(Boolean(capabilities.git && host.gitStatus)); setRetainedWorktreeDispositionAvailable(Boolean(capabilities.retainedWorktreeDisposition)); setPlanAvailable(Boolean(capabilities.plan && host.getPlans)); setComputerUseAvailable(Boolean(capabilities.computerUse && host.getComputerUseState)) }).catch(() => { setCanRevealInFinder(false); setBrowserAvailable(false); setTerminalAvailable(false); setGitAvailable(false); setRetainedWorktreeDispositionAvailable(false); setPlanAvailable(false); setComputerUseAvailable(false) }); if (!host.probeGitBinary) { setGitBinary('unknown'); return } void host.probeGitBinary().then(installed => setGitBinary(Boolean(installed))).catch(() => setGitBinary('unknown')) }, [host, refreshProjects])
  useEffect(() => {
    if (!host.browser || !selectedSession || isExternalSessionId(selectedSession)) return
    void host.browser.selectSession(selectedSession)
  }, [host, selectedSession])
  useEffect(() => {
    if (!host.browser) return
    return host.browser.subscribe(event => {
      if (event.type === 'reveal' && event.sessionId === selectedSession) rememberToolReturn('Browser')
    })
  }, [host, rememberToolReturn, selectedSession])
  useEffect(() => {
    if (!host.terminal?.subscribeAll) return
    return host.terminal.subscribeAll((event: TerminalEvent) => {
      if (event.type === 'opened') setAnnouncedTerminals(current => ({ ...current, [event.sessionId]: event.terminal }))
      if (event.type === 'reveal' && event.sessionId === selectedSession) { setRevealedTerminalIds(current => ({ ...current, [event.sessionId]: event.terminalId })); rememberToolReturn('Terminal') }
    })
  }, [host, rememberToolReturn, selectedSession])
  useEffect(() => {
    let mounted = true
    const unsubscribe = host.subscribeAgents(event => {
      if (event.type !== 'agent') return
      setSidebarAgents(current => mergeAgentSummary(current, event.agent))
    })
    void host.listAgents().then(snapshot => {
      if (mounted) setSidebarAgents(current => mergeAgentSnapshot(current, snapshot))
    }).catch(() => undefined)
    return () => { mounted = false; unsubscribe() }
  }, [host])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey === sidebarStorageKey) return
    let active = true
    const saved = readSidebarPreferences(sidebarStorageKey)
    const projectIds = new Set(projects.map(project => project.id))
    if (saved) {
      setSidebarExpandedIds(saved.expandedIds.filter(id => projectIds.has(id)))
      setSidebarVisibleLimit(saved.visibleLimit)
    } else if (!loadedSidebarPreferencesKey) {
      setSidebarExpandedIds(projects.map(project => project.id))
      setSidebarVisibleLimit(SIDEBAR_PROJECT_PAGE_SIZE)
    } else {
      // A durable project mutation changes the workspace key. Keep UI-only
      // disclosure/pin/page preferences instead of treating it as a reset.
      setSidebarExpandedIds(current => current.filter(id => projectIds.has(id)))
    }
    void (async () => {
      let pinned = saved?.pinnedSessionIds ?? []
      let archived = saved?.archivedSessionIds ?? []
      let archivedTimestamps = saved?.archivedSessionTimestamps ?? {}
      if (host.getSidebarSessionPreferences && host.setSidebarSessionPreferences) {
        const remote = await host.getSidebarSessionPreferences()
        const migrated = localStorage.getItem(sidebarSemanticMigrationKey) === '1'
        if (migrated) {
          pinned = remote.pinnedSessionIds
          archived = remote.archivedSessionIds
          archivedTimestamps = remote.archivedSessionTimestamps ?? {}
        } else {
          archived = [...new Set([...remote.archivedSessionIds, ...archived])]
          archivedTimestamps = { ...archivedTimestamps, ...(remote.archivedSessionTimestamps ?? {}) }
          const archivedSet = new Set(archived)
          pinned = [...new Set([...remote.pinnedSessionIds, ...pinned])].filter(id => !archivedSet.has(id))
          archivedTimestamps = normalizeArchiveTimestamps(archived, archivedTimestamps)
          await host.setSidebarSessionPreferences({ pinnedSessionIds: pinned, archivedSessionIds: archived, archivedSessionTimestamps: archivedTimestamps, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION })
          localStorage.setItem(sidebarSemanticMigrationKey, '1')
        }
      }
      if (!active) return
      archivedTimestamps = normalizeArchiveTimestamps(archived, archivedTimestamps)
      setPinnedSessionIds(pinned)
      setArchivedSessionIds(archived)
      setArchivedSessionTimestamps(archivedTimestamps)
      setLoadedSidebarPreferencesKey(sidebarStorageKey)
    })().catch(error => {
      if (!active) return
      setProjectError(`加载侧栏偏好失败：${error instanceof Error ? error.message : String(error)}`)
      setPinnedSessionIds(saved?.pinnedSessionIds ?? [])
      setArchivedSessionIds(saved?.archivedSessionIds ?? [])
      setArchivedSessionTimestamps(normalizeArchiveTimestamps(saved?.archivedSessionIds ?? [], saved?.archivedSessionTimestamps))
      setLoadedSidebarPreferencesKey(sidebarStorageKey)
    })
    return () => { active = false }
  }, [host, loadedSidebarPreferencesKey, projects, sidebarStorageKey])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey !== sidebarStorageKey) return
    writeSidebarPreferences(sidebarStorageKey, { expandedIds: sidebarExpandedIds, pinnedSessionIds, archivedSessionIds, archivedSessionTimestamps, visibleLimit: sidebarVisibleLimit })
    if (host.setSidebarSessionPreferences) {
      void host.setSidebarSessionPreferences({ pinnedSessionIds, archivedSessionIds, archivedSessionTimestamps, orderedSessionIds: [], sessionOrderVersion: SESSION_ORDER_VERSION }).catch(error => setProjectError(`保存侧栏偏好失败：${error instanceof Error ? error.message : String(error)}`))
    }
  }, [host, loadedSidebarPreferencesKey, pinnedSessionIds, archivedSessionIds, archivedSessionTimestamps, projects.length, sidebarExpandedIds, sidebarStorageKey, sidebarVisibleLimit])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey !== sidebarStorageKey || archivedSessionIds.length === 0) return
    const cleanup = async () => {
      const expired = expiredArchivedSessionIds(archivedSessionIds, archivedSessionTimestamps)
      for (const sessionId of expired) {
        if (archiveCleanupInFlightRef.current.has(sessionId)) continue
        archiveCleanupInFlightRef.current.add(sessionId)
        try {
          try {
            await host.deleteSession(sessionId)
          } catch (error) {
            // Already-gone sessions are the cleanup goal. Keep retrying only for
            // transient host/filesystem failures, not for a missing session file.
            if (!isUnknownSessionError(error)) {
              setProjectError(`自动删除过期归档失败：${error instanceof Error ? error.message : String(error)}`)
              continue
            }
          }
          locallyCreatedSessionIdsRef.current.delete(sessionId)
          skippedInitialEmptyHistoryRef.current.delete(sessionId)
          const archivedSet = new Set(archivedSessionIds)
          const fallback = sessions.find(session => session.id !== sessionId && !archivedSet.has(session.id))
          setSessions(current => current.filter(session => session.id !== sessionId))
          setArchivedSessionIds(current => current.filter(id => id !== sessionId))
          setArchivedSessionTimestamps(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)))
          setPinnedSessionIds(current => current.filter(id => id !== sessionId))
          if (selectedSession === sessionId) {
            setSelectedSession(fallback?.id ?? '')
            if (fallback) setSelectedProject(fallback.projectId)
          }
        } finally {
          archiveCleanupInFlightRef.current.delete(sessionId)
        }
      }
    }
    void cleanup()
    const timer = window.setInterval(() => { void cleanup() }, ARCHIVE_CLEANUP_RETRY_MS)
    return () => window.clearInterval(timer)
  }, [archivedSessionIds, archivedSessionTimestamps, host, loadedSidebarPreferencesKey, projects.length, selectedSession, sessions, sidebarStorageKey])
  useEffect(() => {
    if (!projectsLoaded || !selectedProject) return
    const request = beginSessionListRequest(selectedProject)
    void host.listSessions(selectedProject).then(items => {
      if (!isCurrentSessionListRequest(selectedProject, request.generation)) return
      const retainIds = new Set(locallyCreatedSessionIdsRef.current)
      if (selectedSessionRef.current) retainIds.add(selectedSessionRef.current)
      setSessions(current => {
        const existing = current.filter(session => session.projectId === selectedProject)
        const merged = mergeSessionSnapshot(existing, items, {
          titleRevisionsAtRequest: request.titleRevisions,
          currentTitleRevisions: sessionTitleRevisionByIdRef.current,
          retainIds,
        })
        setSelectedSession(previous => merged.some(item => item.id === previous) || isExternalSessionId(previous) ? previous : merged[0]?.id ?? '')
        return [
          ...current.filter(session => session.projectId !== selectedProject),
          ...merged,
        ]
      })
    }).catch(error => setProjectError(`加载会话列表失败：${error instanceof Error ? error.message : String(error)}`))
    if (!host.listExternalSessions || scanExternal.loading || !scanExternal.enabled) return
    void host.listExternalSessions(selectedProject).then(items => {
      setExternalSessions(current => replaceProjectExternalSessions(current, selectedProject, items))
    }).catch(() => {
      setExternalSessions(current => replaceProjectExternalSessions(current, selectedProject, []))
    })
  }, [beginSessionListRequest, host, isCurrentSessionListRequest, projectsLoaded, selectedProject])
  useEffect(() => {
    if (scanExternal.loading) return
    if (!scanExternal.enabled) {
      setExternalSessions(current => current.length === 0 ? current : [])
      if (!isExternalSessionId(selectedSessionRef.current)) return
      const fallback = sessionsRef.current.find(session => session.projectId === selectedProjectRef.current)
        ?? sessionsRef.current[0]
      if (fallback) {
        setSelectedProject(fallback.projectId)
        setSelectedSession(fallback.id)
      } else {
        setSelectedSession('')
      }
      return
    }
    if (!projectsLoaded || !host.listExternalSessions) return
    void loadExternalSessionsForProjects(host.listExternalSessions, projects).then(items => {
      setExternalSessions(items)
    })
  }, [host, projects, projectsLoaded, scanExternal.enabled, scanExternal.loading])
  useEffect(() => {
    if (!projectsLoaded || !selectedProject || !selectedSession) return
    const knownPi = sessions.some(session => session.id === selectedSession && session.projectId === selectedProject)
    const knownExternal = externalSessions.some(session => session.id === selectedSession && session.projectId === selectedProject)
    if (!knownPi && !knownExternal) return
    try { localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify({ projectId: selectedProject, sessionId: selectedSession })) } catch { /* storage can be disabled by the host */ }
  }, [externalSessions, projectsLoaded, selectedProject, selectedSession, sessions])
  useEffect(() => {
    document.title = sessions.find(session => session.id === selectedSession)?.name
      ?? externalSessions.find(session => session.id === selectedSession)?.title
      ?? 'PipiUI'
  }, [externalSessions, selectedSession, sessions])
  useEffect(() => {
    let current = true
    const sessionId = selectedSession
    if (isExternalSessionId(sessionId)) {
      setModelState(null)
      return () => { current = false }
    }
    const provisional = modelStatesBySessionRef.current.get(sessionId)
      ?? modelStateFromSession(sessionsRef.current.find(session => session.id === sessionId), modalVisibility.models)
    const immediate = provisional && reconcileModelStateWithCatalog(provisional, modalVisibility.models)
    if (immediate) {
      if (sessionId) {
        modelStatesBySessionRef.current.set(sessionId, immediate)
        rememberSessionModel(sessionId, immediate.model)
      }
      setModelState(immediate)
    }
    const writeGen = modelWriteGenRef.current
    void host.getModelState(selectedSession || undefined)
      .then(state => {
        if (!current || modelWriteGenRef.current !== writeGen) return
        const reconciled = reconcileModelStateWithCatalog(state, modalVisibility.models)
        if (sessionId) {
          modelStatesBySessionRef.current.set(sessionId, reconciled)
          rememberSessionModel(sessionId, reconciled.model)
        }
        setModelState(reconciled)
      })
      // Failure fallback: the session's own model (from listSessions) keeps the
      // chip/row per-session even when the host model query itself failed.
      .catch(() => {
        if (!current || !selectedSession || modelWriteGenRef.current !== writeGen) return
        const ref = sessionsRef.current.find(session => session.id === selectedSession)?.model
        if (ref) {
          const model: Model = { provider: ref.provider, id: ref.modelId, name: ref.modelId }
          rememberSessionModel(selectedSession, model)
          setModelState({ model, thinkingLevel: 'off', availableThinkingLevels: thinkingLevelsForModel(model) })
        }
      })
    return () => { current = false }
  }, [host, modalVisibility.models, selectedSession])
  useEffect(() => {
    const request = ++historyLoadRef.current
    const requestLiveRevision = transcriptLiveRevisionRef.current
    let staleRetryScheduled = false
    let staleRetryTimer: number | undefined
    let emptyPageRetryScheduled = false
    let emptyPageRetryTimer: number | undefined
    const previousContext = historyContextRef.current
    const contextChanged = previousContext?.host !== host || previousContext.sessionId !== selectedSession
    historyContextRef.current = { host, sessionId: selectedSession }
    if (!selectedSession) {
      setMessages([])
      setLease(null)
      return
    }
    if (isExternalSessionId(selectedSession)) {
      setLease(null)
      setStreaming(false)
      setCompacting(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
      if (contextChanged) {
        const cachedExt = messagesBySessionRef.current.get(selectedSession)
        messagesRef.current = cachedExt ?? []
        setMessages(cachedExt ?? [])
      }
      if (!host.getExternalSessionHistory) {
        const placeholder = externalHistoryToMessages({
          id: selectedSession,
          source: 'claude',
          availability: 'none',
          entries: [],
        })
        messagesBySessionRef.current.set(selectedSession, placeholder)
        messagesRef.current = placeholder
        setMessages(placeholder)
        return
      }
      void host.getExternalSessionHistory(selectedSession).then(history => {
        if (historyLoadRef.current !== request) return
        const next = externalHistoryToMessages(history)
        messagesBySessionRef.current.set(selectedSession, next)
        messagesRef.current = next
        setMessages(next)
        setExternalAdoptableById(current => ({ ...current, [selectedSession]: canAdoptExternalHistory(history) }))
      }).catch(error => {
        if (historyLoadRef.current !== request) return
        setProjectError(`读取外部会话记录失败：${error instanceof Error ? error.message : String(error)}`)
      })
      return
    }
    const cached = messagesBySessionRef.current.get(selectedSession)
    // Skip the first JSONL read for a session this UI just created. An empty
    // in-memory cache is not proof the file is still empty: the host may have
    // written the turn while this renderer missed stream events. Skipping again
    // on a later select would hide on-disk history forever.
    const knownNewEmptySession = contextChanged
      && locallyCreatedSessionIdsRef.current.has(selectedSession)
      && cached?.length === 0
      && historyCompleteBySessionRef.current.get(selectedSession) === true
      && !skippedInitialEmptyHistoryRef.current.has(selectedSession)
    if (knownNewEmptySession) skippedInitialEmptyHistoryRef.current.add(selectedSession)
    if (contextChanged) {
      activeUserTurnRef.current = false
      mainTurnOpenRef.current = false
      mainTurnEpochRef.current += 1
      turnJustSettledRef.current = false
      // Restore a visited transcript this tick so switching back does not flash
      // empty and wait for another JSONL parse on the host.
      messagesRef.current = cached ?? []
      setMessages(cached ?? [])
      setCompacting(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
      setSubagentWaitingStartedAt(null)
    }
    // A session still observed as running may be a lost settle: JSONL already
    // has the conclusion, but `agent_settled` never arrived. Do not flash
    // "模型仍在处理" until history confirms the turn is still open.
    const resumedRunning = observedSessionStatusesRef.current[selectedSession] === 'running'
    if (contextChanged) {
      setStreaming(resumedRunning)
      if (resumedRunning) {
        mainTurnOpenRef.current = true
        activeUserTurnRef.current = true
      }
      setLease(null)
    }
    const closeLostSettle = () => {
      mainTurnOpenRef.current = false
      activeUserTurnRef.current = false
      turnJustSettledRef.current = true
      setStreaming(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
      applyObservedStatus(selectedSession, 'completed')
      const settled = finishStreamingMessage(messagesRef.current)
      if (settled !== messagesRef.current) {
        transcriptLiveRevisionRef.current += 1
        messagesRef.current = settled
        messagesBySessionRef.current.set(selectedSession, settled)
        setMessages(settled)
      }
    }
    const openResumeWait = (liveMessages: ChatMessage[], historyMessages: ChatMessage[]) => {
      const last = liveMessages[liveMessages.length - 1] ?? historyMessages[historyMessages.length - 1]
      setStreaming(true)
      setWaitingStartedAt(Date.now())
      setWaitingVisible(true)
      setWaitingPhase(last && assistantEndedAwaitingModel(last) ? 'thinking' : waitingPhaseForTurn(liveMessages.length ? liveMessages : historyMessages))
      setWaitingDetail(undefined)
    }
    const resumeOrCloseLostSettle = (historyMessages: ChatMessage[], liveMessages = messagesRef.current) => {
      if (!resumedRunning) return
      if (historyConfirmsLostSettle(historyMessages, liveMessages)) {
        closeLostSettle()
        return
      }
      openResumeWait(liveMessages, historyMessages)
    }
    const restoreOpenHop = (snapshot: ChatMessage[], live: ChatMessage[]): ChatMessage[] => {
      if (!mainTurnOpenRef.current) return snapshot
      if (historyConfirmsLostSettle(snapshot, live)) return snapshot
      const liveLast = live[live.length - 1]
      if (!liveLast || liveLast.role !== 'assistant' || !assistantEndedAwaitingModel(liveLast)) return snapshot
      return reopenAssistantForNextCompletion(snapshot, { includeHistoryMergedToolHop: true })
    }
    const applyRestoredOpenHop = (snapshot: ChatMessage[]) => {
      const restored = restoreOpenHop(snapshot, messagesRef.current)
      if (restored === messagesRef.current) return
      messagesBySessionRef.current.set(selectedSession, restored)
      messagesRef.current = restored
      setMessages(restored)
    }
    const applyHistory = (entries: HistoryEntry[]) => {
      if (historyLoadRef.current !== request) return
      const reconciliation = reconcileHistorySnapshot(
        entries,
        requestLiveRevision,
        transcriptLiveRevisionRef.current,
        historyFingerprintBySessionRef.current.get(selectedSession),
        messagesRef.current,
      )
      if (reconciliation.status === 'retained-longer-live') {
        resumeOrCloseLostSettle(messagesRef.current)
        applyRestoredOpenHop(messagesRef.current)
        return
      }
      if (reconciliation.status === 'stale-request') {
        // A stream mutation supersedes this request generation. While a turn is
        // open its terminal event owns the retry; otherwise schedule one bounded
        // exact-context retry instead of letting the old response win.
        if (!mainTurnOpenRef.current && !staleRetryScheduled) {
          staleRetryScheduled = true
          staleRetryTimer = window.setTimeout(() => {
            if (historyLoadRef.current === request
              && historyContextRef.current?.host === host
              && historyContextRef.current.sessionId === selectedSession) {
              setHistoryRefreshKey(key => key + 1)
            }
          }, 0)
        }
        return
      }
      if (reconciliation.status === 'unchanged') {
        resumeOrCloseLostSettle(reconciliation.messages)
        applyRestoredOpenHop(messagesRef.current)
        return
      }
      const next = reconciliation.messages
      historyFingerprintBySessionRef.current.set(selectedSession, reconciliation.fingerprint)
      if (transcriptFingerprint(messagesRef.current) === reconciliation.fingerprint) {
        resumeOrCloseLostSettle(next)
        applyRestoredOpenHop(messagesRef.current)
        return
      }
      const liveBefore = messagesRef.current
      const restored = restoreOpenHop(next, liveBefore)
      messagesBySessionRef.current.set(selectedSession, restored)
      setMessages(restored)
      messagesRef.current = restored
      if (resumedRunning) {
        if (historyConfirmsLostSettle(next, liveBefore)) closeLostSettle()
        else openResumeWait(liveBefore, restored)
      } else {
        const last = restored[restored.length - 1]
        turnJustSettledRef.current = Boolean(last && last.role === 'assistant' && !last.streaming)
      }
    }
    // Cache is an immediate rendering optimization, never the source of truth.
    // Re-read JSONL on every selection/reconnect and after terminal status so
    // missed/coalesced stream events converge without another live token.
    if (!knownNewEmptySession) {
      historyCompleteBySessionRef.current.set(selectedSession, false)
      void (async () => {
        let before: string | undefined
        let accumulated: HistoryEntry[] = []
        let loadedPage = false
        let cursorRestarts = 0
        try {
          while (historyLoadRef.current === request) {
            let page: HistoryEntry[]
            try {
              page = before === undefined
                ? await host.getSessionHistory(selectedSession)
                : await host.getSessionHistory(selectedSession, before, HISTORY_PAGE_SIZE)
            } catch (error) {
              // A compaction landing mid-pagination rewrites the visible branch
              // and retires the cursor id. Restart from the newest page instead
              // of failing the whole load (bounded so a pathological loop ends).
              if (cursorRestarts < 2 && error instanceof Error && error.message.includes('history cursor no longer exists')) {
                cursorRestarts += 1
                before = undefined
                accumulated = []
                loadedPage = false
                continue
              }
              throw error
            }
            if (historyLoadRef.current !== request) return
            if (page.length === 0) {
              const cachedMessages = messagesBySessionRef.current.get(selectedSession)
              const hasCached = (cachedMessages?.length ?? 0) > 0
              if (!loadedPage && !hasCached && !emptyPageRetryScheduled) {
                emptyPageRetryScheduled = true
                emptyPageRetryTimer = window.setTimeout(() => {
                  if (historyLoadRef.current === request
                    && historyContextRef.current?.host === host
                    && historyContextRef.current.sessionId === selectedSession) {
                    setHistoryRefreshKey(key => key + 1)
                  }
                }, 250)
                return
              }
              if (!loadedPage && !hasCached) applyHistory([])
              historyCompleteBySessionRef.current.set(selectedSession, true)
              return
            }
            accumulated = [...page, ...accumulated]
            applyHistory(accumulated)
            loadedPage = true
            if (page.length < HISTORY_PAGE_SIZE) {
              historyCompleteBySessionRef.current.set(selectedSession, true)
              return
            }
            const nextBefore = page[0]?.id
            if (!nextBefore || nextBefore === before) throw new Error('主机返回了无效的会话历史游标')
            before = nextBefore
          }
        } catch (error) {
          if (historyLoadRef.current !== request) return
          historyCompleteBySessionRef.current.set(selectedSession, false)
          setProjectError(`读取会话记录失败：${error instanceof Error ? error.message : String(error)}`)
          // Keep a cached transcript or any successfully loaded newer pages.
        }
      })()
    }
    void host.getSessionLease(selectedSession).then(lease => { if (historyLoadRef.current === request) setLease(lease) }).catch(() => { if (historyLoadRef.current === request) setLease(null) })
    return () => {
      if (staleRetryTimer !== undefined) window.clearTimeout(staleRetryTimer)
      if (emptyPageRetryTimer !== undefined) window.clearTimeout(emptyPageRetryTimer)
    }
  }, [historyRefreshKey, host, selectedSession])
  useEffect(() => {
    if (!selectedSession || isExternalSessionId(selectedSession) || !leaseConflictError) return
    let cancelled = false
    void host.getSessionLease(selectedSession).then(next => {
      if (!cancelled) setLease(next)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [host, selectedSession, leaseConflictError])
  useEffect(() => {
    // Runs after the history-load effect above and the stream-subscription effect
    // below: by the next macrotask the new session's transcript and live events
    // are wired, so the pending auto-send prompt can be dispatched safely.
    const pending = pendingAutoSendRef.current
    if (!pending || pending.sessionId !== selectedSession) return
    pendingAutoSendRef.current = null
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          mutateLocalTranscript(items => [...items, { id: crypto.randomUUID(), role: 'user', content: pending.prompt, images: pending.attachments?.length ? pending.attachments.map(attachment => ({ data: attachment.url, mimeType: attachment.mimeType })) : undefined, timestamp: Date.now() }])
          activeUserTurnRef.current = true
          mainTurnOpenRef.current = true
          mainTurnEpochRef.current += 1
          applyObservedStatus(pending.sessionId, 'running')
          setStreaming(true)
          setWaitingStartedAt(Date.now())
          setWaitingVisible(true)
          setWaitingPhase('awaiting')
          setWaitingDetail(undefined)
          setSessions(current => current.map(session => session.id === pending.sessionId ? { ...session, updatedAt: Date.now() } : session))
          const payload = pending.attachments?.length ? await Promise.all(pending.attachments.map(toPromptAttachment)) : undefined
          if (payload?.length) {
            const converted = chatImagesFromAttachments(payload)
            mutateLocalTranscript(items => items.map(message => message.images?.some(image => image.data.startsWith('blob:')) ? { ...message, images: converted } : message))
          }
          const documentPaths = pending.documents?.map(document => document.path).filter(Boolean) ?? []
          if (documentPaths.length) await host.notifyComposerDocumentsDropped?.(pending.sessionId, documentPaths)?.catch(error => console.warn('[composer-docs]', error))
          if (payload?.length) await host.sendPrompt(pending.sessionId, pending.prompt, payload)
          else await host.sendPrompt(pending.sessionId, pending.prompt)
        } catch (error) {
          activeUserTurnRef.current = false
          mainTurnOpenRef.current = false
          if (observedSessionStatusesRef.current[pending.sessionId] === 'running') applyObservedStatus(pending.sessionId, 'completed')
          setStreaming(false)
          setWaitingVisible(false)
          setWaitingStartedAt(null)
          setWaitingDetail(undefined)
          setProjectError(`发送失败：${hostOperationError(error)}`)
        }
      })()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [host, mutateLocalTranscript, selectedSession])
  useEffect(() => {
    if (!selectedSession) return
    let active = true
    let terminalReconcileTimer: number | undefined
    let terminalReconcilePending = false
    const scheduleTerminalReconciliation = () => {
      if (terminalReconcilePending) return
      terminalReconcilePending = true
      setHistoryRefreshKey(key => key + 1)
      terminalReconcileTimer = window.setTimeout(() => {
        terminalReconcilePending = false
        if (active
          && selectedSessionRef.current === selectedSession
          && historyContextRef.current?.host === host) {
          setHistoryRefreshKey(key => key + 1)
        }
      }, 250)
    }
    const coalescer = new StreamEventCoalescer({ onEvent: event => {
      if (event.type === 'queue_update') {
        sessionQueue.acceptStreamEvent(event)
        return
      }
      if (event.type === 'session_title') {
        markSessionTitleMutation(event.sessionId)
        setSessions(current => current.map(session => session.id === event.sessionId
          ? { ...session, name: event.title, updatedAt: Date.now() }
          : session))
        return
      }
      if (event.type === 'compaction') {
        setCompacting(event.phase === 'start')
        transcriptLiveRevisionRef.current += 1
        const next = [...messagesRef.current, { id: crypto.randomUUID(), role: 'tool' as const, content: compactionNotice(event) }]
        messagesRef.current = next
        setMessages(next)
        // Post-compaction pi reports null tokens until the next assistant usage;
        // pull one authoritative snapshot so the pill drops the stale number.
        if (event.phase === 'end') setStatsRefreshKey(key => key + 1)
        return
      }
      if (event.type === 'secret_redact') {
        const next = applySecretRedact(messagesRef.current, event.messages)
        if (next !== messagesRef.current) {
          transcriptLiveRevisionRef.current += 1
          messagesRef.current = next
          messagesBySessionRef.current.set(event.sessionId, next)
          setMessages(next)
        }
        return
      }
      if (event.type === 'user_message') {
        const pendingEcho = pendingLocalUserRef.current
        pendingLocalUserRef.current = null
        const next = appendLiveUserMessage(messagesRef.current, event, pendingEcho ?? undefined)
        if (next !== messagesRef.current) transcriptLiveRevisionRef.current += 1
        messagesRef.current = next
        setMessages(next)
        // A real follow-up (queue drain or a triggerTurn wake) can land after a
        // bare `started` was ignored as a ghost. Reopen the turn so later
        // tools in the same tick are not dropped as `turnClosed`. A late
        // terminal/heartbeat/stalled `[subagent-*]` row after a closed turn is
        // only a projection — it has no new epoch or later settle.
        const subagentSignal = parseSubagentSignal(event.content)
        const drainedPrompt = !pendingEcho && Boolean(event.content.trim())
        const alreadyRunning = mainTurnOpenRef.current
          || activeUserTurnRef.current
          || observedSessionStatusesRef.current[event.sessionId] === 'running'
        if ((subagentSignal || drainedPrompt) && shouldOpenTurnOnUserMessage(event.content, alreadyRunning)) {
          // A host-drained prompt is a new completion epoch even if a lost
          // settle left the prior turn marked open. Its later agent terminal
          // must never reconcile the new prompt against old history.
          if (!pendingEcho) mainTurnEpochRef.current += 1
          // A host-drained prompt is a new completion epoch even if a lost
          // settle left the prior turn marked open. Its later agent terminal
          // must never reconcile the new prompt against old history.
          if (!activeUserTurnRef.current) {
            activeUserTurnRef.current = true
            mainTurnOpenRef.current = true
            turnJustSettledRef.current = false
            applyObservedStatus(event.sessionId, 'running')
            setStreaming(true)
            setWaitingStartedAt(Date.now())
            setWaitingVisible(true)
          }
          setWaitingPhase(subagentSignal ? 'followup' : waitingPhaseForTurn(next, [event.content]))
        }
        return
      }
      if (event.type === 'status') {
        const terminal = event.status === 'settled' || event.status === 'stopped'
        const openedTurnEpoch = openedTurnEpochBySessionRef.current.get(event.sessionId)
        // Durable history recovery is independent of whether this terminal is
        // allowed to mutate the currently open turn. A renderer which missed
        // the matching start must still pull the persisted final assistant.
        if (terminal) scheduleTerminalReconciliation()
        // A late `streaming` after settle is a follow-up-list update, not a new
        // turn. Ignoring it keeps the composer idle instead of 生成中 with no work.
        if (event.status === 'streaming' && !mainTurnOpenRef.current) return
        // Bare started after a finished assistant is a ghost turn (duplicate
        // agent_start, or App restart which resets turnJustSettledRef). A newer
        // backend epoch is authoritative even when its triggerTurn user row has
        // not arrived yet and pendingFollowUps is empty.
        if (event.status === 'started' && !shouldOpenWaitOnStarted(messagesRef.current, event.pendingFollowUps, event.turnEpoch, openedTurnEpoch)) return
        if (staleTurnTerminal(event, openedTurnEpoch)) return
        const sidebarStatus: SessionStatus = event.status === 'started' || event.status === 'streaming'
          ? 'running'
          : event.status === 'settled' ? 'completed' : 'interrupted'
        applyObservedStatus(event.sessionId, sidebarStatus)
        if (event.status === 'started' || event.status === 'streaming') {
          if (event.status === 'started') {
            if (!mainTurnOpenRef.current) mainTurnEpochRef.current += 1
            if (event.turnEpoch !== undefined) openedTurnEpochBySessionRef.current.set(event.sessionId, event.turnEpoch)
            mainTurnOpenRef.current = true
            turnJustSettledRef.current = false
            const continued = reopenAssistantForNextCompletion(messagesRef.current)
            if (continued !== messagesRef.current) {
              transcriptLiveRevisionRef.current += 1
              messagesRef.current = continued
              setMessages(continued)
            }
          }
          setStreaming(true)
          setSessions(current => current.map(session => session.id === event.sessionId ? { ...session, updatedAt: Date.now() } : session))
          // Any active main turn owns the wait, not just a local send. Follow-ups
          // after visible assistant output use `continuing` so the copy does not
          // claim to wait for the first response. A tool-ended hop is thinking.
          if (!activeUserTurnRef.current) {
            const last = messagesRef.current[messagesRef.current.length - 1]
            activeUserTurnRef.current = true
            setWaitingStartedAt(Date.now())
            setWaitingVisible(true)
            setWaitingPhase(last && assistantEndedAwaitingModel(last)
              ? 'thinking'
              : waitingPhaseForTurn(messagesRef.current, event.pendingFollowUps))
            setWaitingDetail(undefined)
          }
        }
        if (terminal) {
          closeOpenTurnRef.current(event.sessionId, sidebarStatus === 'completed' ? 'completed' : 'interrupted')
        }
        return
      }
      // Thinking and tool runs live inside folded cards — keep the placeholder
      // visible with an appropriate phase so the user never sees a silent gap
      // between the turn start and the first readable text. Only real text
      // output ends the first-token wait (streaming itself keeps going until
      // settled/stopped, which the Composer reflects). After the last tool
      // finishes, openai-completions providers often generate the next step
      // with no thinking/text deltas — reopen a thinking wait so the tail
      // does not look idle while the composer still says 生成中.
      const turnClosed = !mainTurnOpenRef.current && (
        observedSessionStatusesRef.current[event.sessionId] === 'completed'
        || observedSessionStatusesRef.current[event.sessionId] === 'interrupted'
      )
      if (turnClosed) {
        // Do not unconditionally drop late live events after settle — they would
        // otherwise wait for the 250ms history reconcile and appear as "stuck then flood".
        // Tradeoff: immediate apply may briefly diverge from history, but the
        // fingerprint-based reconcile dedups and preserves source of truth;
        // immediate refresh avoids batch涌出 while keeping content不丢不双显.
        const isLiveContent = event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'error'
        if (isLiveContent) {
          const lateNext = applyStreamEvent(messagesRef.current, event)
          if (lateNext !== messagesRef.current) {
            transcriptLiveRevisionRef.current += 1
            messagesRef.current = lateNext
            setMessages(lateNext)
          }
          if (event.type === 'text' && event.delta.trim()) setWaitingVisible(false)
          else if (event.type === 'thinking') { setWaitingVisible(true); setWaitingPhase('thinking'); setWaitingDetail(undefined) }
          else if (event.type === 'tool_call') { setWaitingVisible(true); setWaitingPhase('tool'); if (event.name === 'subagent') setWaitingDetail('子任务执行中'); else setWaitingDetail(toolDisplaySummary(event.name, event.delta ?? '')) }
          else if (event.type === 'tool_result') { if (streamingAssistantToolsAllFinished(messagesRef.current)) { setWaitingVisible(true); setWaitingStartedAt(Date.now()); setWaitingPhase('thinking'); setWaitingDetail(undefined) } else setWaitingPhase('tool') }
          if (historyContextRef.current?.host === host && historyContextRef.current.sessionId === event.sessionId) setHistoryRefreshKey(key => key + 1)
          return
        }
        return
      }
      const next = applyStreamEvent(messagesRef.current, event)
      if (next !== messagesRef.current) {
        transcriptLiveRevisionRef.current += 1
        messagesRef.current = next
        setMessages(next)
      }
      if (event.type === 'text') {
        if (event.delta.trim()) setWaitingVisible(false)
      } else if (event.type === 'thinking') {
        setWaitingVisible(true)
        setWaitingPhase('thinking')
        setWaitingDetail(undefined)
      } else if (event.type === 'tool_call') {
        setWaitingVisible(true)
        setWaitingPhase('tool')
        if (event.name === 'subagent') setWaitingDetail('子任务执行中')
        else setWaitingDetail(toolDisplaySummary(event.name, event.delta ?? ''))
      } else if (event.type === 'tool_result') {
        if (streamingAssistantToolsAllFinished(messagesRef.current)) {
          setWaitingVisible(true)
          setWaitingStartedAt(Date.now())
          setWaitingPhase('thinking')
          setWaitingDetail(undefined)
        } else {
          setWaitingPhase('tool')
        }
      }
    } })
    // Background (non-selected) sessions still owe the sidebar their main-agent
    // status: a settle that lands while another session is selected must not
    // leave a sticky 「进行中」 row, and a turn started elsewhere must show. This
    // is a side channel only — the filtered subscription below keeps delivering
    // the selected stream, and every transcript/waiting mutation in this effect
    // assumes that one stream. Old hosts without subscribeAllStreams simply
    // keep the previous selected-only behavior.
    const unsubscribeBackground = host.subscribeAllStreams?.(event => {
      if (event.sessionId === selectedSession) return
      if (event.type === 'secret_redact') {
        const current = messagesBySessionRef.current.get(event.sessionId)
        if (current) {
          const next = applySecretRedact(current, event.messages)
          if (next !== current) messagesBySessionRef.current.set(event.sessionId, next)
        }
        return
      }
      if (event.type === 'user_message') {
        if (shouldOpenTurnOnUserMessage(event.content, observedSessionStatusesRef.current[event.sessionId] === 'running')) {
          applyObservedStatus(event.sessionId, 'running')
        }
        return
      }
      if (event.type === 'status') {
        const openedTurnEpoch = openedTurnEpochBySessionRef.current.get(event.sessionId)
        // Late `streaming` after settle is a follow-up-list update, not a new turn.
        if (event.status === 'streaming' && observedSessionStatusesRef.current[event.sessionId] !== 'running') return
        // Bare started after a finished assistant is a ghost (duplicate agent_start).
        if (event.status === 'started' && !shouldOpenWaitOnStarted(messagesBySessionRef.current.get(event.sessionId) ?? [], event.pendingFollowUps, event.turnEpoch, openedTurnEpoch)) return
        if (staleTurnTerminal(event, openedTurnEpoch)) return
        if (event.status === 'started' && event.turnEpoch !== undefined) {
          openedTurnEpochBySessionRef.current.set(event.sessionId, event.turnEpoch)
        }
        applyObservedStatus(event.sessionId, event.status === 'started' || event.status === 'streaming'
          ? 'running'
          : event.status === 'settled' ? 'completed' : 'interrupted')
        return
      }
      if (event.type === 'session_title') {
        markSessionTitleMutation(event.sessionId)
        setSessions(current => current.map(session => session.id === event.sessionId
          ? { ...session, name: event.title, updatedAt: Date.now() }
          : session))
      }
    })
    const unsubscribe = isExternalSessionId(selectedSession)
      ? () => undefined
      : host.subscribeStream(selectedSession, event => {
      if (event.sessionId !== selectedSessionRef.current) return
      coalescer.push(event)
    })
    return () => {
      active = false
      if (terminalReconcileTimer !== undefined) window.clearTimeout(terminalReconcileTimer)
      unsubscribeBackground?.()
      unsubscribe()
      coalescer.dispose()
    }
  }, [applyObservedStatus, host, markSessionTitleMutation, selectedSession, sessionQueue.acceptStreamEvent])
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(widths)) }, [widths])
  // Auto-collapse is the narrow-width default on every entry (Swift sidebarCollapseWidth).
  useEffect(() => { if (narrowViewport) setNarrowPanes({ sidebar: false, tools: false }) }, [narrowViewport])

  // Overlay-scrollbar scroll tracking (Swift OverlayScrollers parity).
  // Adds .pipiui-scrolling to any element that is actively scrolling so the
  // CSS overlay scrollbar brightens during scroll.  Uses capture phase on
  // both document and window because the native scroll event does not bubble
  // and some containers (e.g. react-virtuoso internals) may target either.
  useEffect(() => {
    const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
    const onScroll = (event: Event) => {
      const target = event.target
      if (!target || target === document || target === window) return
      if (!(target instanceof Element)) return
      target.classList.add('pipiui-scrolling')
      const prev = timers.get(target)
      if (prev !== undefined) clearTimeout(prev)
      timers.set(target, setTimeout(() => { target.classList.remove('pipiui-scrolling') }, 1200))
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const sidebarCollapsed = narrowViewport ? !narrowPanes.sidebar : widths.sidebarCollapsed
  const toolsCollapsed = narrowViewport ? !narrowPanes.tools : widths.toolsCollapsed
  const selectedProjectPath = projects.find(project => project.id === selectedProject)?.path
  useEffect(() => () => { if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current) }, [])

  const stopSelectedSession = useCallback(() => {
    const targetSession = selectedSession
    if (!targetSession || isExternalSessionId(targetSession) || stoppingSessionRef.current === targetSession) return
    stoppingSessionRef.current = targetSession
    setStopError(current => current?.sessionId === targetSession ? null : current)
    closeOpenTurn(targetSession, 'interrupted', { keepStopGuard: true })
    void host.stop(targetSession).then(() => {
      if (stoppingSessionRef.current === targetSession) stoppingSessionRef.current = null
    }).catch(error => {
      if (stoppingSessionRef.current !== targetSession) return
      stoppingSessionRef.current = null
      setStopError({ sessionId: targetSession, message: `停止失败：${error instanceof Error ? error.message : String(error)}` })
    })
  }, [closeOpenTurn, host, selectedSession])

  /** First-open / empty "新会话" has no session id. Send, model, and thinking
   *  chips still mount, so create the session before any 3-arg host call.
   *  `beforeSelect` runs before setSelectedSession so callers can arm effects
   *  that key on the new id (auto-send must not race the render). */
  const ensureSession = async (beforeSelect?: (sessionId: string) => void): Promise<string | null> => {
    if (selectedSession && !isExternalSessionId(selectedSession)) return selectedSession
    if (!selectedProject) return null
    const session = await host.newSession(selectedProject)
    locallyCreatedSessionIdsRef.current.add(session.id)
    messagesBySessionRef.current.set(session.id, [])
    historyCompleteBySessionRef.current.set(session.id, true)
    beforeSelect?.(session.id)
    setSessions(items => [session, ...items])
    setSelectedProject(selectedProject)
    setSelectedSession(session.id)
    setSidebarExpandedIds(current => current.includes(selectedProject) ? current : [...current, selectedProject])
    return session.id
  }

  const send = async (draft: string, attachments?: ComposerAttachment[], documents?: ComposerDocument[]) => {
    const documentPaths = documents?.map(document => document.path).filter(Boolean) ?? []
    const prompt = draft.trim() || (documentPaths.length ? DEFAULT_COMPOSER_DOCUMENT_PROMPT : '')
    if (!prompt && !attachments?.length) return false
    if (selectedSession && isExternalSessionId(selectedSession)) return false
    let targetSession: string | null = selectedSession
    if (!targetSession) {
      // Empty "新会话" state used to make Send a silent no-op; create the session
      // in the selected project and dispatch the prompt as soon as it is selected.
      // No lease exists yet in this state, so the write gate below must not apply.
      targetSession = await ensureSession(sessionId => {
        pendingAutoSendRef.current = { sessionId, prompt, attachments, documents }
      })
      if (!targetSession) return false
      return true
    }
    if (!canWriteLease) return false
    const beginDirectTurn = () => {
      const localUserId = crypto.randomUUID()
      pendingLocalUserRef.current = { id: localUserId, content: prompt }
      mutateLocalTranscript(items => [...items, { id: localUserId, role: 'user', content: prompt, images: attachments?.length ? attachments.map(attachment => ({ data: attachment.url, mimeType: attachment.mimeType })) : undefined, timestamp: Date.now() }])
      activeUserTurnRef.current = true
      mainTurnOpenRef.current = true
      mainTurnEpochRef.current += 1
      // The sidebar row of a backgrounded session must flip to 进行中 before the
      // first status event arrives — a send followed by an immediate switch away
      // would otherwise look idle for the whole turn.
      applyObservedStatus(targetSession, 'running')
      setStreaming(true)
      setWaitingStartedAt(Date.now())
      setWaitingVisible(true)
      setWaitingPhase('awaiting')
      setWaitingDetail(undefined)
      setSessions(current => current.map(session => session.id === targetSession ? { ...session, updatedAt: Date.now() } : session))
    }
    const resetFailedDirectTurn = () => {
      activeUserTurnRef.current = false
      mainTurnOpenRef.current = false
      if (observedSessionStatusesRef.current[targetSession] === 'running') applyObservedStatus(targetSession, 'completed')
      setStreaming(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
    }

    // The optimistic bubble previews pasted images via their object URLs; once
    // the base64 payload is read, swap the previews for the durable data URLs.
    // (The bubble id may already have been replaced by the server echo, so match
    // by the blob: preview marker instead of the local id.)
    const patchOptimisticImages = (payload: PromptAttachment[]) => {
      const converted = chatImagesFromAttachments(payload)
      mutateLocalTranscript(items => items.map(message => message.images?.some(image => image.data.startsWith('blob:')) ? { ...message, images: converted } : message))
    }

    if (sessionQueue.busy) {
      // Optimistic local echo even while busy — mirrors direct send's mutateLocalTranscript + pendingLocalUserRef.
      // Host user_message will dedup via pendingLocalUserRef / queued content match; queued flag gives light "排队中" visual.
      const localUserId = crypto.randomUUID()
      pendingLocalUserRef.current = { id: localUserId, content: prompt }
      mutateLocalTranscript(items => [...items, { id: localUserId, role: 'user', content: prompt, images: attachments?.length ? attachments.map(attachment => ({ data: attachment.url, mimeType: attachment.mimeType })) : undefined, timestamp: Date.now(), queued: true } as ChatMessage])
      const payload = attachments?.length ? await Promise.all(attachments.map(toPromptAttachment)) : undefined
      if (payload?.length) {
        const converted = chatImagesFromAttachments(payload)
        mutateLocalTranscript(items => items.map(message => message.id === localUserId && message.images?.some(image => image.data.startsWith('blob:')) ? { ...message, images: converted } : message))
      }
      if (documentPaths.length) await host.notifyComposerDocumentsDropped?.(targetSession, documentPaths)?.catch(error => console.warn('[composer-docs]', error))
      const result = await sessionQueue.enqueue(prompt, payload)
      if (result.outcome === 'queued' || selectedSession !== targetSession) return true
      // Race: host dispatched directly despite busy check. Clear queued visual and open turn (bubble already exists).
      mutateLocalTranscript(items => items.map(m => m.id === localUserId && (m as ChatMessage).queued ? { ...m, queued: undefined } as ChatMessage : m))
      activeUserTurnRef.current = true
      mainTurnOpenRef.current = true
      mainTurnEpochRef.current += 1
      applyObservedStatus(targetSession, 'running')
      setStreaming(true)
      setWaitingStartedAt(Date.now())
      setWaitingVisible(true)
      setWaitingPhase('awaiting')
      setWaitingDetail(undefined)
      setSessions(current => current.map(session => session.id === targetSession ? { ...session, updatedAt: Date.now() } : session))
      return true
    }

    beginDirectTurn()
    try {
      if (documentPaths.length) await host.notifyComposerDocumentsDropped?.(targetSession, documentPaths)?.catch(error => console.warn('[composer-docs]', error))
      const payload = attachments?.length ? await Promise.all(attachments.map(toPromptAttachment)) : undefined
      if (payload?.length) patchOptimisticImages(payload)
      if (payload?.length) await host.sendPrompt(targetSession, prompt, payload)
      else await host.sendPrompt(targetSession, prompt)
      return true
    } catch (error) {
      resetFailedDirectTurn()
      throw error
    }
  }
  const requestUpdate = (prompt: string) => {
    closeModelManager()
    void send(prompt).catch(error => setProjectError(`发送失败：${error instanceof Error ? error.message : String(error)}`))
  }
  /**
   * `/compact`. Progress and the outcome normally arrive as `compaction` stream
   * events; a refusal ("Nothing to compact") never produces one, so the
   * rejection is what the transcript reports.
   */
  const compact = async () => {
    if (!selectedSession || isExternalSelected || !canWriteLease || !host.compact) return
    setCompacting(true)
    try {
      await host.compact(selectedSession)
    } catch (error) {
      setCompacting(false)
      mutateLocalTranscript(items => [...items, { id: crypto.randomUUID(), role: 'tool', content: `上下文压缩失败：${error instanceof Error ? error.message : String(error)}` }])
    }
  }
  const handleCopy = async (message: ChatMessage) => {
    const text = displaySecretPlaceholders(message.role === 'user' ? stripAttachmentPathsForDisplay(message.content) : message.content)
    if (!text.trim()) return
    await navigator.clipboard.writeText(text)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    setCopiedId(message.id)
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedId(current => current === message.id ? null : current)
      copiedTimerRef.current = null
    }, 1200)
  }
  const handleResend = (message: ChatMessage) => {
    // Electron has no fork/resend RPC yet: this deliberately sends a new prompt.
    const text = displaySecretPlaceholders(message.role === 'user' ? stripAttachmentPathsForDisplay(message.content) : message.content)
    void send(text).catch(() => undefined)
  }
  const resendDisabled = Boolean(!canWriteLease || streaming || sessionQueue.busy)

  const newSession = async (projectId = selectedProject) => {
    if (!projectId) return
    if (selectedSession) messagesBySessionRef.current.set(selectedSession, messagesRef.current)
    let session
    try {
      session = await host.newSession(projectId)
    } catch (error) {
      setProjectError(`创建会话失败：${hostOperationError(error)}`)
      return
    }
    locallyCreatedSessionIdsRef.current.add(session.id)
    messagesBySessionRef.current.set(session.id, [])
    historyCompleteBySessionRef.current.set(session.id, true)
    setSessions(items => [session, ...items])
    setSelectedProject(projectId)
    setSelectedSession(session.id)
    setSidebarExpandedIds(current => current.includes(projectId) ? current : [...current, projectId])
    setMessages([])
    messagesRef.current = []
    if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: false }))
  }
  const adoptExternalSession = async (sessionId = selectedSession) => {
    if (!sessionId || !isExternalSessionId(sessionId) || !host.adoptExternalSession) return
    setAdoptError(null)
    setAdoptingExternalId(sessionId)
    try {
      const session = await host.adoptExternalSession(sessionId)
      setExternalSessions(current => current.filter(item => item.id !== sessionId))
      setSessions(items => [session, ...items.filter(item => item.id !== session.id)])
      setSelectedProject(session.projectId)
      setSelectedSession(session.id)
      setSidebarExpandedIds(current => current.includes(session.projectId) ? current : [...current, session.projectId])
    } catch (error) {
      setAdoptError(`接管失败：${hostOperationError(error)}`)
    } finally {
      setAdoptingExternalId(null)
    }
  }
  const viewOriginalExternalSession = (sessionId: string) => {
    const adopted = sessions.find(item => item.id === sessionId)?.adoptedFrom
    if (!adopted) return
    setSelectedSession(adopted.externalSessionId)
  }
  const completeAddProject = async (normalizedPath: string): Promise<boolean> => {
    // Adding a folder must not silently `git init` it. Non-git projects stay
    // plain folders; writable workers then run in the project directory.
    const snapshot = { projects, sessions, selectedProject, selectedSession }
    const name = normalizedPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || normalizedPath
    const optimistic: Project = { id: `pending-project:${normalizedPath}`, name, path: normalizedPath }
    setProjects(current => current.some(project => project.path === normalizedPath) ? current : [optimistic, ...current])
    setSidebarExpandedIds(current => current.includes(optimistic.id) ? current : [...current, optimistic.id])
    setProjectError(null)
    try {
      await host.addProject!(normalizedPath)
    } catch (error) {
      setProjects(snapshot.projects)
      setSessions(snapshot.sessions)
      setSelectedProject(snapshot.selectedProject)
      setSelectedSession(snapshot.selectedSession)
      setSidebarExpandedIds(current => current.filter(id => id !== optimistic.id))
      setProjectError(`添加项目失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    try {
      const items = await refreshProjects()
      const added = items.find(project => project.path === normalizedPath)
      if (added) {
        const existing = await host.listSessions(added.id)
        if (existing.length === 0) await newSession(added.id)
      }
      return true
    } catch (error) {
      setProjectError(`添加项目后刷新失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
  const addProject = async (): Promise<boolean> => {
    if (!host.pickProjectDirectory || !host.addProject) {
      setProjectError('当前连接不支持添加项目')
      return false
    }
    let path: string | null
    try {
      path = await host.pickProjectDirectory()
    } catch (error) {
      setProjectError(`选择项目文件夹失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    if (!path) return false
    const normalizedPath = path.trim()
    if (!normalizedPath) return false
    return completeAddProject(normalizedPath)
  }
  const removeProject = async (projectId: string) => {
    if (!host.removeProject) {
      setProjectError('当前连接不支持移除项目')
      return
    }
    const snapshot = { projects, sessions, selectedProject, selectedSession }
    const remainingProjects = projects.filter(project => project.id !== projectId)
    const remainingSessions = sessions.filter(session => session.projectId !== projectId)
    const fallbackProjectId = remainingProjects[0]?.id ?? ''
    const fallbackSessionId = remainingSessions.find(session => session.projectId === fallbackProjectId)?.id ?? remainingSessions[0]?.id ?? ''
    setProjects(remainingProjects)
    setSessions(remainingSessions)
    setSidebarExpandedIds(current => current.filter(id => id !== projectId))
    setPinnedSessionIds(current => current.filter(id => remainingSessions.some(session => session.id === id)))
    if (selectedProject === projectId) setSelectedProject(fallbackProjectId)
    if (!remainingSessions.some(session => session.id === selectedSession)) setSelectedSession(fallbackSessionId)
    setProjectError(null)
    try {
      await host.removeProject(projectId)
    } catch (error) {
      setProjects(snapshot.projects)
      setSessions(snapshot.sessions)
      setSelectedProject(snapshot.selectedProject)
      setSelectedSession(snapshot.selectedSession)
      setProjectError(`移除项目失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    try {
      await refreshProjects()
    } catch (error) {
      setProjectError(`移除项目后刷新失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const sidebarSessionById = useMemo(() => {
    const mapped = new Map<string, SidebarSession>()
    for (const session of sessions) {
      const model = sidebarModelForSession(session, selectedSession, modelState?.model ?? null, sessionModels)
      const status = sidebarStatusForSession(session.id, selectedSession, streaming, observedSessionStatuses[session.id], sidebarAgents)
      mapped.set(session.id, { id: session.id, projectId: session.projectId, title: session.name, provider: model.provider, modelId: model.modelId, source: 'pi', adoptedFromSource: session.adoptedFrom?.source, status: status.status, subagentCount: status.subagentCount, updatedAt: session.updatedAt })
    }
    for (const session of externalSessions) {
      mapped.set(session.id, {
        id: session.id,
        projectId: session.projectId,
        title: session.title,
        provider: session.source,
        source: session.source,
        status: 'idle',
        updatedAt: session.updatedAt,
      })
    }
    return mapped
  }, [externalSessions, modelState, observedSessionStatuses, selectedSession, sessionModels, sessions, sidebarAgents, streaming])
  const pinnedSessionIdSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])
  const archivedSessionIdSet = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const pinnedSidebarSessions = useMemo(() => sessionsByActivityAndManualOrder(
    pinnedSessionIds.flatMap(id => {
      const session = sidebarSessionById.get(id)
      return session ? [session] : []
    })
  ), [pinnedSessionIds, sidebarSessionById])
  // Archived sessions are global (not per-project), Swift archivedSessionsSection parity.
  const archivedSidebarSessions = useMemo(() => archivedSessionIds.flatMap(id => {
    const session = sidebarSessionById.get(id)
    return session ? [session] : []
  }), [archivedSessionIds, sidebarSessionById])
  const sidebarProjects = useMemo<SidebarProject[]>(() => projects.map(project => ({
    id: project.id,
    name: project.name,
    path: project.path,
    // Pinned sessions live in the dedicated section; archived ones in the global archive.
    sessions: sessionsByActivityAndManualOrder([
      ...sessions.filter(session => session.projectId === project.id && !pinnedSessionIdSet.has(session.id) && !archivedSessionIdSet.has(session.id)),
      ...externalSessions.filter(session => session.projectId === project.id && !pinnedSessionIdSet.has(session.id) && !archivedSessionIdSet.has(session.id)),
    ]).flatMap(session => {
      const mapped = sidebarSessionById.get(session.id)
      return mapped ? [mapped] : []
    })
  })), [archivedSessionIdSet, externalSessions, pinnedSessionIdSet, projects, sessions, sidebarSessionById])
  const sidebarProjectMenuUnavailable = useMemo<ProjectMenuUnavailable>(() => ({
    ...(!host.renameProject ? { rename: '待宿主支持' } : {}),
    ...(!host.removeProject ? { remove: '当前连接不支持移除项目' } : {}),
    ...(!canRevealInFinder ? { reveal: '当前连接不支持在 Finder 中显示' } : {})
  }), [canRevealInFinder, host.removeProject, host.renameProject])
  const toggleSidebarProject = (projectId: string) => {
    setSidebarExpandedIds(current => current.includes(projectId) ? current.filter(id => id !== projectId) : [...current, projectId])
  }
  const selectSidebarSession = (sessionId: string) => {
    if (selectedSession && selectedSession !== sessionId) {
      messagesBySessionRef.current.set(selectedSession, messagesRef.current)
    }
    const cached = messagesBySessionRef.current.get(sessionId)
    if (cached !== undefined) {
      messagesRef.current = cached
      setMessages(cached)
    } else {
      messagesRef.current = []
      setMessages([])
    }
    const session = sessions.find(item => item.id === sessionId)
    const external = externalSessions.find(item => item.id === sessionId)
    const expandProjectIfSessionHidden = (projectId: string, status: SessionStatus) => {
      setSidebarExpandedIds(current => {
        if (current.includes(projectId)) return current
        // Peeked working rows stay visible under a collapsed folder; don't auto-expand.
        if (status === 'running' || status === 'subagents-running') return current
        return [...current, projectId]
      })
    }
    if (session) {
      setSelectedProject(session.projectId)
      const status = sidebarStatusForSession(session.id, selectedSession, streaming, observedSessionStatuses[session.id], sidebarAgents).status
      expandProjectIfSessionHidden(session.projectId, status)
    } else if (external) {
      setSelectedProject(external.projectId)
      setSidebarExpandedIds(current => current.includes(external.projectId) ? current : [...current, external.projectId])
    }
    if (isExternalSessionId(sessionId)) {
      setModelState(null)
      setSelectedSession(sessionId)
      if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: false }))
      return
    }
    const provisional = modelStatesBySessionRef.current.get(sessionId)
      ?? modelStateFromSession(session, modalVisibility.models)
    const immediate = provisional && reconcileModelStateWithCatalog(provisional, modalVisibility.models)
    if (immediate) {
      modelStatesBySessionRef.current.set(sessionId, immediate)
      rememberSessionModel(sessionId, immediate.model)
      setModelState(immediate)
    } else {
      setModelState(null)
    }
    setSelectedSession(sessionId)
    if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: false }))
  }

  const applySelectedModelState = (state: ModelState) => {
    modelWriteGenRef.current += 1
    const previous = selectedSession
      ? modelStatesBySessionRef.current.get(selectedSession)
      : modelState
    if (selectedSession) {
      modelStatesBySessionRef.current.set(selectedSession, state)
      rememberSessionModel(selectedSession, state.model)
    }
    setModelState(state)
    // Model identity changes the context window and per-model accounting.
    // Thinking-only switches must not refresh stats/quota/balance.
    const sameModel = previous
      && previous.model.provider === state.model.provider
      && previous.model.id === state.model.id
    if (!sameModel) setStatsRefreshKey(key => key + 1)
  }
  const persistComposerDraft = (draft: string) => {
    if (!selectedSession) return
    if (draft === '') draftsBySessionRef.current.delete(selectedSession)
    else draftsBySessionRef.current.set(selectedSession, draft)
  }
  const persistComposerAttachments = (attachments: ComposerAttachment[]) => {
    if (!selectedSession) return
    if (attachments.length === 0) attachmentsBySessionRef.current.delete(selectedSession)
    else attachmentsBySessionRef.current.set(selectedSession, attachments)
  }
  const persistComposerDocuments = (documents: ComposerDocument[]) => {
    if (!selectedSession) return
    if (documents.length === 0) documentsBySessionRef.current.delete(selectedSession)
    else documentsBySessionRef.current.set(selectedSession, documents)
  }
  // App unmount: revoke object URLs parked for every session (the Composer only
  // ever sees the selected session's attachments, so it cannot clean them all).
  useEffect(() => () => {
    for (const parked of attachmentsBySessionRef.current.values()) {
      for (const attachment of parked) URL.revokeObjectURL(attachment.url)
    }
  }, [])
  const onSidebarProjectMenu = (projectId: string, action: ProjectMenuAction) => {
    if (action === 'newSession') { void newSession(projectId); return }
    if (action === 'reveal' && canRevealInFinder) {
      void host.revealProject?.(projectId).catch(error => setProjectError(`在文件管理器中显示失败：${error instanceof Error ? error.message : String(error)}`))
    }
    if (action === 'remove') void removeProject(projectId)
  }
  const renameSidebarProject = async (projectId: string, name: string) => {
    if (!host.renameProject) {
      setProjectError('当前连接不支持重命名项目')
      return
    }
    const previous = projects.find(project => project.id === projectId)
    if (!previous || previous.name === name) return
    setProjects(current => current.map(project => project.id === projectId ? { ...project, name } : project))
    try {
      const renamed = await host.renameProject(projectId, name)
      setProjects(current => current.map(project => project.id === projectId ? renamed : project))
    } catch (error) {
      setProjects(current => current.map(project => project.id === projectId ? previous : project))
      setProjectError(`修改项目名称失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  const pinSidebarSession = (sessionId: string) => {
    if (isExternalSessionId(sessionId)) return
    setPinnedSessionIds(current => current.includes(sessionId) ? current.filter(id => id !== sessionId) : [...current, sessionId])
  }
  const renameSidebarSession = async (sessionId: string, title: string) => {
    if (isExternalSessionId(sessionId)) return
    const previous = sessions.find(session => session.id === sessionId)
    if (!previous || previous.name === title) return
    markSessionTitleMutation(sessionId)
    setSessions(current => current.map(session => session.id === sessionId ? { ...session, name: title, updatedAt: Date.now() } : session))
    try {
      const renamed = await host.renameSession(sessionId, title)
      markSessionTitleMutation(sessionId)
      setSessions(current => current.map(session => session.id === sessionId ? renamed : session))
    } catch (error) {
      markSessionTitleMutation(sessionId)
      setSessions(current => current.map(session => session.id === sessionId ? previous : session))
      setProjectError(`修改会话名称失败：${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  const archiveSidebarSession = (sessionId: string) => {
    if (isExternalSessionId(sessionId)) return
    setArchivedSessionIds(current => current.includes(sessionId) ? current : [...current, sessionId])
    setArchivedSessionTimestamps(current => current[sessionId] === undefined ? { ...current, [sessionId]: Date.now() } : current)
    setPinnedSessionIds(current => current.filter(id => id !== sessionId))
    if (selectedSession === sessionId) {
      const archived = new Set([...archivedSessionIds, sessionId])
      const fallback = sessions.find(session => !archived.has(session.id))
      setSelectedSession(fallback?.id ?? '')
      if (fallback) setSelectedProject(fallback.projectId)
    }
  }
  const unarchiveSidebarSession = (sessionId: string) => {
    setArchivedSessionIds(current => current.filter(id => id !== sessionId))
    setArchivedSessionTimestamps(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sessionId)))
  }
  const moveSidebarProject = async (sourceId: string, targetId: string, placement: SidebarDropPlacement) => {
    if (!host.setProjectPaths || sourceId === targetId) return
    const snapshot = projects
    const ids = movedIds(projects.map(project => project.id), sourceId, targetId, placement)
    const byId = new Map(projects.map(project => [project.id, project]))
    const next = ids.flatMap(id => byId.get(id) ?? [])
    setProjects(next)
    try {
      await host.setProjectPaths(next.map(project => project.path))
    } catch (error) {
      setProjects(snapshot)
      setProjectError(`调整项目顺序失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const moveSidebarSession = async (sessionId: string, targetProjectId: string) => {
    if (isExternalSessionId(sessionId)) return
    const source = sessions.find(session => session.id === sessionId)
    if (!source || source.projectId === targetProjectId) return
    const snapshot = sessions
    const snapshotPinned = pinnedSessionIds
    setSessions(current => current.map(session => session.id === sessionId ? { ...session, projectId: targetProjectId } : session))
    setPinnedSessionIds(current => current.filter(id => id !== sessionId))
    setSidebarExpandedIds(current => current.includes(targetProjectId) ? current : [...current, targetProjectId])
    try {
      const moved = await host.moveSession(sessionId, targetProjectId)
      setSessions(current => current.map(session => session.id === sessionId ? moved : session))
      if (selectedSession === sessionId) setSelectedProject(targetProjectId)
    } catch (error) {
      setSessions(snapshot)
      setPinnedSessionIds(snapshotPinned)
      setProjectError(`移动会话失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const moveSidebarSessionToPinned = (sessionId: string) => {
    if (isExternalSessionId(sessionId)) return
    setPinnedSessionIds(current => current.includes(sessionId) ? current : [...current, sessionId])
  }
  const resize = (pane: keyof PaneWidths, start: number) => (event: React.PointerEvent) => { const origin = event.clientX; const onMove = (move: PointerEvent) => setWidths(current => ({ ...current, [pane]: clamp(start + (pane === 'sidebar' ? move.clientX - origin : origin - move.clientX), pane === 'sidebar' ? 190 : 270, pane === 'sidebar' ? 440 : 620) })); const done = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done) }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', done) }
  const resizeTools = (event: React.PointerEvent) => {
    const origin = event.clientX
    const browser = activeTab === 'Browser'
    const key: 'tools' | 'browserTools' = browser ? 'browserTools' : 'tools'
    const start = widths[key]
    const onMove = (move: PointerEvent) => setWidths(current => ({ ...current, [key]: clamp(start + origin - move.clientX, browser ? 520 : 270, browser ? 920 : 620) }))
    const done = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', done)
  }
  const toggleSidebar = () => {
    if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: !current.sidebar }))
    else setWidths(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }))
  }
  const toggleTools = () => {
    if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: !current.tools }))
    else setWidths(current => ({ ...current, toolsCollapsed: !current.toolsCollapsed }))
  }
  const expandTools = useCallback(() => {
    if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: true }))
    else setWidths(current => current.toolsCollapsed ? { ...current, toolsCollapsed: false } : current)
  }, [narrowViewport])
  const navigateTool = useCallback((tab: PanelTab) => {
    rememberToolReturn(tab)
    expandTools()
  }, [expandTools, rememberToolReturn])
  const goBackTool = useCallback(() => {
    const target = toolReturnTab ?? DEFAULT_PANEL_TAB
    setToolReturnTab(null)
    applyActiveTab(target)
  }, [applyActiveTab, toolReturnTab])
  /** Swift panelQuickRail behavior: switching opens the panel, re-clicking the active tool closes it. */
  const selectTool = (tab: PanelTab) => {
    if (!toolsCollapsed && activeTab === tab) {
      if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: false }))
      else setWidths(current => ({ ...current, toolsCollapsed: true }))
      return
    }
    navigateTool(tab)
  }
  const openQwenTokenPlanLogin = async () => {
    // Swift InputBar parity: the Token Plan login capsule opens the embedded
    // browser at the bailian plan page; the quota pill appears once logged in.
    if (!selectedSession || !host.browser) return
    try {
      await host.browser.newTab(selectedSession, { url: QWEN_TOKEN_PLAN_LOGIN_URL })
    } catch (error) {
      setProjectError(`打开 Token Plan 登录页失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    navigateTool('Browser')
  }
  const revealSubagentsForNewRun = useCallback(() => {
    if (narrowViewport) return
    // Match Swift: reveal a new run only when the right pane is closed. An
    // already-open Browser/Document/Terminal tab remains under user control.
    if (!toolsCollapsed) return
    navigateTool('Subagents')
  }, [narrowViewport, navigateTool, toolsCollapsed])
  /** Subagent tool-card click: always open the Subagents pane (Swift card tap parity). */
  const openSubagents = useCallback(() => {
    navigateTool('Subagents')
  }, [navigateTool])
  const announceOpenedDocuments = useCallback((paths: string[]) => {
    const supported = filterSupportedDocumentPaths(paths)
    if (!supported.length) return supported
    const sessionId = selectedSessionRef.current
    if (sessionId && !isExternalSessionId(sessionId)) {
      void host.notifyDocumentsDropped?.(sessionId, supported)?.catch(error => console.warn('[document-drop]', error))
    }
    return supported
  }, [host])
  const rememberOpenedDocument = useCallback((path: string) => {
    const sessionId = selectedSessionRef.current
    if (!sessionId) return
    setOpenedDocumentPaths(current => current[sessionId] === path ? current : { ...current, [sessionId]: path })
  }, [])
  const openDocument = useCallback((path: string) => {
    const supported = announceOpenedDocuments([path])
    rememberOpenedDocument(supported[supported.length - 1] ?? path)
    navigateTool('Document')
  }, [announceOpenedDocuments, navigateTool, rememberOpenedDocument])
  const openDroppedDocuments = useCallback((paths: string[]) => {
    const supported = announceOpenedDocuments(paths)
    if (!supported.length) return
    rememberOpenedDocument(supported[supported.length - 1]!)
    navigateTool('Document')
  }, [announceOpenedDocuments, navigateTool, rememberOpenedDocument])

  const browserWorkspaceActive = activeTab === 'Browser' && !toolsCollapsed
  const browserFullscreenActive = browserWorkspaceActive && browserWorkspaceFullscreen
  const shellClass = `pipiui-shell${isElectronChrome() ? ' electron-chrome' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}${toolsCollapsed ? ' tools-collapsed' : ''}${browserWorkspaceActive ? ' browser-workspace' : ''}${browserFullscreenActive ? ' browser-workspace-fullscreen' : ''}`
  // The first-response wait (any active main turn) takes precedence at the
  // transcript tail; while it is hidden, a running background subagent keeps the
  // tail alive with a stable-timed phase=tool indicator and no stop button.
  const firstResponseWaiting = waitingVisible && waitingStartedAt !== null
    ? { startedAt: waitingStartedAt, phase: waitingPhase, detail: waitingDetail, onStop: stopSelectedSession }
    : undefined
  const subagentWaiting = !firstResponseWaiting && subagentsRunningCount > 0 && subagentWaitingStartedAt !== null
    ? { startedAt: subagentWaitingStartedAt, phase: 'tool' as const, detail: `${subagentsRunningCount} 个子任务执行中` }
    : undefined
  const selectedExternalSession = externalSessions.find(item => item.id === selectedSession)
  const headerSession = sessions.find(item => item.id === selectedSession)
    ?? (selectedExternalSession
      ? { id: selectedExternalSession.id, projectId: selectedExternalSession.projectId, name: selectedExternalSession.title, updatedAt: selectedExternalSession.updatedAt }
      : undefined)
  const dismissNarrowOverlays = () => setNarrowPanes({ sidebar: false, tools: false })
  return <main className={shellClass} data-theme={theme} style={{ '--sidebar-w': `${widths.sidebar}px`, '--tools-w': `${browserWorkspaceActive ? widths.browserTools : widths.tools}px` } as React.CSSProperties}>
    {narrowViewport && (!sidebarCollapsed || !toolsCollapsed) && <div className="pane-overlay-backdrop" data-testid="pane-overlay-backdrop" onMouseDown={dismissNarrowOverlays} />}
    <Sidebar projects={sidebarProjects} pinnedSessions={pinnedSidebarSessions} archivedSessions={archivedSidebarSessions} expandedIds={sidebarExpandedIds} selectedSessionId={selectedSession || null} searchQuery={sidebarSearch} visibleLimit={sidebarVisibleLimit} collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebar} onToggleProject={toggleSidebarProject} onSelectSession={selectSidebarSession} onNewSession={projectId => void newSession(projectId)} onProjectMenu={onSidebarProjectMenu} onRenameProject={host.renameProject ? renameSidebarProject : undefined} projectMenuUnavailable={sidebarProjectMenuUnavailable} onMoveProject={host.setProjectPaths ? moveSidebarProject : undefined} onMoveSession={moveSidebarSession} onMoveSessionToPinned={moveSidebarSessionToPinned} onAddProject={addProject} projectAddUnavailable={host.pickProjectDirectory && host.addProject ? undefined : '当前连接不支持添加项目'} projectError={projectError} onDismissProjectError={() => setProjectError(null)} onSearch={setSidebarSearch} onShowMore={() => setSidebarVisibleLimit(limit => limit + SIDEBAR_PROJECT_PAGE_SIZE)} onPinSession={pinSidebarSession} onRenameSession={renameSidebarSession} onArchiveSession={archiveSidebarSession} onUnarchiveSession={unarchiveSidebarSession} onViewOriginalSession={viewOriginalExternalSession} onOpenSettings={openModelManager} onOpenComputerUse={computerUseAvailable ? () => setComputerUseOpen(true) : undefined} onOpenRemote={() => setRemoteOpen(true)} onOpenSubagentModels={() => setSubagentModelsOpen(true)} />
    <ResizeHandle label="调整左栏宽度" side="left" onPointerDown={resize('sidebar', widths.sidebar)} />
    <section className="chat-column">
      <ChatHeader session={headerSession} project={projects.find(item => item.id === selectedProject)} lease={lease} host={host} gitAvailable={gitAvailable} sidebarCollapsed={sidebarCollapsed} toolsCollapsed={toolsCollapsed} onToggleSidebar={toggleSidebar} onToggleTools={toggleTools} onRename={renameSidebarSession} onTakeover={async () => { if (selectedSession && !isExternalSelected) setLease(await host.forceTakeoverSessionLease(selectedSession)) }} externalReadOnly={isExternalSelected} externalSource={selectedExternalSession?.source} canAdoptExternal={Boolean(isExternalSelected && host.adoptExternalSession && selectedExternalSession && externalSessionLooksAdoptable(selectedExternalSession) && externalAdoptableById[selectedSession] !== false)} adoptDisabledReason={isExternalSelected && selectedExternalSession && !externalSessionLooksAdoptable(selectedExternalSession) ? '此外部会话只有元数据，没有可导入的正文' : isExternalSelected && externalAdoptableById[selectedSession] === false ? '此外部会话没有可导入的正文' : undefined} adopting={adoptingExternalId === selectedSession} adoptError={adoptError} onDismissAdoptError={() => setAdoptError(null)} onAdoptExternal={() => void adoptExternalSession()} onViewOriginal={headerSession?.adoptedFrom ? () => viewOriginalExternalSession(headerSession.id) : undefined} />
      <div className="chat-viewport" data-testid="chat-viewport">
        {toolsCollapsed && <ToolQuickRail variant="float" activeTab={activeTab} toolsCollapsed={toolsCollapsed} onSelect={selectTool} host={host} browserAvailable={browserAvailable} terminalAvailable={terminalAvailable} planTabVisible={planTabVisible} planProgress={planProgressBadge} subagentsRunningCount={subagentsRunningCount} />}
        {projectsLoaded && !selectedSession ? (
          <div className="empty-setup-viewport">
            <EmptySetupGuide
              modelsLoading={modalVisibility.loading}
              hasModels={modalVisibility.models.length > 0}
              hasProjects={projects.length > 0}
              gitInstalled={gitBinary}
              onAddApiKey={openAddProvider}
              onAddProject={() => { void addProject() }}
              onNewSession={() => { const projectId = selectedProject || projects[0]?.id; if (projectId) void newSession(projectId) }}
            />
          </div>
        ) : (
        <LiveSubagentBindingProvider host={host} sessionId={selectedSession}>
          {(() => {
            const ids = (selectedSession && !mountedSessionIds.includes(selectedSession)
              ? [selectedSession, ...mountedSessionIds]
              : mountedSessionIds).slice(0, 6)
            if (ids.length === 0) {
              return <Transcript messages={messages} documentBasePath={selectedProjectPath} onOpenDocument={openDocument} onOpenSubagents={openSubagents} onCopy={handleCopy} onResend={handleResend} resendDisabled={resendDisabled} copiedId={copiedId} waiting={firstResponseWaiting ?? subagentWaiting} />
            }
            return ids.map(id => (
              <div key={id} className="session-transcript-slot" data-session-transcript={id} hidden={id !== selectedSession}>
                <Transcript
                  active={id === selectedSession}
                  messages={id === selectedSession ? messages : (messagesBySessionRef.current.get(id) ?? [])}
                  documentBasePath={selectedProjectPath}
                  onOpenDocument={openDocument}
                  onOpenSubagents={openSubagents}
                  onCopy={handleCopy}
                  onResend={handleResend}
                  resendDisabled={resendDisabled}
                  copiedId={id === selectedSession ? copiedId : null}
                  waiting={id === selectedSession ? firstResponseWaiting ?? subagentWaiting : undefined}
                />
              </div>
            ))
          })()}
        </LiveSubagentBindingProvider>
        )}
      </div>
      {selectedSession ? <div className="chat-composer-stack" data-testid="chat-composer-stack">
        {sessionQueue.error && <div className="queue-operation-error" role="alert" data-testid="queue-operation-error"><span>{sessionQueue.error}</span><button aria-label="关闭队列错误" onClick={sessionQueue.dismissError}>×</button></div>}
        <PlanApprovalBar host={host} sessionId={selectedSession} readOnly={leaseReadOnly} onSend={send} />
        <MessageQueue items={sessionQueue.items} expanded={sessionQueue.expanded} pending={sessionQueue.pending} mutationsDisabled={leaseReadOnly} canSteer={sessionQueue.busy} onToggle={() => sessionQueue.setExpanded(!sessionQueue.expanded)} onPromote={id => { if (!leaseReadOnly) void sessionQueue.promote(id).catch(() => undefined) }} onEdit={(id, text) => { if (!leaseReadOnly) void sessionQueue.edit(id, text).catch(() => undefined) }} onRemove={id => { if (!leaseReadOnly) void sessionQueue.remove(id).catch(() => undefined) }} onRetry={id => { if (!leaseReadOnly) void sessionQueue.retry(id).catch(() => undefined) }} onSteer={id => { if (!leaseReadOnly) void sessionQueue.cutIn(id).catch(() => undefined) }} />
        <Composer streaming={streaming} working={sessionWorking} stopping={selectedStopping} stopError={stopError?.sessionId === selectedSession ? stopError.message : null} compacting={compacting} queueBusy={queueLocksComposer} readOnly={leaseReadOnly} leaseOwner={isExternalSelected ? undefined : (leaseReadOnly ? leaseOwnerLabel(lease) : undefined)} onTakeover={isExternalSelected ? undefined : async () => { if (selectedSession) setLease(await host.forceTakeoverSessionLease(selectedSession)) }} readOnlyMessage={isExternalSelected ? `这是 ${sessionSourceLabel(selectedExternalSession?.source)} 的只读会话。` : undefined} hideSessionChrome={isExternalSelected} modelState={modelState} host={host} sessionId={selectedSession} initialDraft={selectedSession ? (draftsBySessionRef.current.get(selectedSession) ?? '') : ''} initialAttachments={selectedSession ? (attachmentsBySessionRef.current.get(selectedSession) ?? EMPTY_COMPOSER_ATTACHMENTS) : EMPTY_COMPOSER_ATTACHMENTS} initialDocuments={selectedSession ? (documentsBySessionRef.current.get(selectedSession) ?? EMPTY_COMPOSER_DOCUMENTS) : EMPTY_COMPOSER_DOCUMENTS} onDraftChange={persistComposerDraft} onAttachmentsChange={persistComposerAttachments} onDocumentsChange={persistComposerDocuments} statsRefreshKey={statsRefreshKey} visibility={modalVisibility} onOpenModelManager={openModelManager} onCompact={compact} onSend={send} onStop={stopSelectedSession} onDismissStopError={() => setStopError(current => current?.sessionId === selectedSession ? null : current)} onModel={applySelectedModelState} onEnsureSession={ensureSession} onOpenBrowserLogin={selectedSession && host.browser && browserAvailable === true ? () => void openQwenTokenPlanLogin() : undefined} visionEnabled={vision.enabled} visionModelRef={vision.model} />
      </div> : null}
    </section>
    <ResizeHandle label="调整工具栏宽度" side="right" onPointerDown={resizeTools} />
    <ToolPanel activeTab={activeTab} collapsed={toolsCollapsed} onToggleCollapsed={toggleTools} rail={!toolsCollapsed ? <ToolQuickRail variant="header" activeTab={activeTab} toolsCollapsed={toolsCollapsed} onSelect={selectTool} host={host} browserAvailable={browserAvailable} terminalAvailable={terminalAvailable} planTabVisible={planTabVisible} planProgress={planProgressBadge} subagentsRunningCount={subagentsRunningCount} /> : null} canGoBack={activeTab !== DEFAULT_PANEL_TAB} onBack={goBackTool} host={host} theme={theme} sessionId={selectedSession} announcedTerminal={selectedSession ? announcedTerminals[selectedSession] : undefined} revealedTerminalId={selectedSession ? revealedTerminalIds[selectedSession] : undefined} onSubagentsRunningCountChange={setSubagentsRunningCount} onSubagentStarted={revealSubagentsForNewRun} onManualSubagentStatusCheck={agentIDs => { void send(makeSubagentStatusCheckPrompt(agentIDs)) }} browserAvailable={browserAvailable} browserOccluded={browserOccluded} terminalAvailable={terminalAvailable} planAvailable={planAvailable} onPlanProgressChange={setPlanProgressBadge} onHasPlansChange={handleHasPlansChange} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} projectId={selectedProject} projectPath={selectedProjectPath} openedDocumentPath={selectedSession ? openedDocumentPaths[selectedSession] ?? null : null} onOpenDocument={openDocument} onDropDocuments={openDroppedDocuments} workspaceFullscreen={browserWorkspaceFullscreen} onToggleWorkspaceFullscreen={() => setBrowserWorkspaceFullscreen(value => !value)} />
    {modalOpen && <ModelVisibilityModal host={host} visibility={modalVisibility} vision={vision} scan={scanExternal} updates={updates} current={modelState?.model ?? null} onModelState={applySelectedModelState} onRequestUpdate={requestUpdate} onClose={closeModelManager} initialView={modalInitialView} projectId={selectedProject} />}
    {computerUseOpen && <ComputerUsePanel host={host} onClose={() => setComputerUseOpen(false)} />}
    {remoteOpen && <RemoteConnectionPanel onClose={() => setRemoteOpen(false)} onAskPipiui={text => { setRemoteOpen(false); void send(text) }} onOpenDebugUrl={url => {
      if (!selectedSession || !host.browser) return
      void host.browser.newTab(selectedSession, { url }).then(() => navigateTool('Browser')).catch(() => undefined)
    }} />}
    {subagentModelsOpen && <SubagentModelModal host={host} current={modelState?.model ?? null} visibility={modalVisibility} onClose={() => setSubagentModelsOpen(false)} />}
    <ExtensionUiHost host={host} sessionId={selectedSession || undefined} />
  </main>
}

function hostOperationError(error: unknown): string {
  if (error && typeof error === 'object' && (error as { code?: string }).code === TRANSPORT_DISCONNECTED) {
    return '连接已断开，操作未完成。请恢复连接后重试，已发出的消息不会自动重发。'
  }
  return error instanceof Error ? error.message : String(error)
}

/** A transcript already showing assistant output (text or a thinking/tool card)
 *  has no first-token wait left. A new `started` after that uses phase
 *  `continuing` so the placeholder still names the wait. */
function hasVisibleAssistantOutput(messages: ChatMessage[]): boolean {
  return messages.some(message => message.role === 'assistant' && (
    Boolean(message.content) ||
    Boolean(message.error) ||
    (message.tools?.length ?? 0) > 0 ||
    Boolean(message.thinking) ||
    (message.activities?.length ?? 0) > 0
  ))
}

/** Host JSONL already has the same text conclusion the live transcript showed.
 *  That is a lost `settled` only when this assistant was still marked
 *  streaming. A finished historical conclusion plus a new `started` is a
 *  first-token wait — closing it is the idle-composer side of the seesaw. */
function historyConfirmsLostSettle(historyMessages: ChatMessage[], liveMessages: ChatMessage[]): boolean {
  const historyLast = historyMessages[historyMessages.length - 1]
  if (!historyLast || !assistantLooksSettled(historyLast)) return false
  const liveLast = liveMessages[liveMessages.length - 1]
  if (!liveLast || liveLast.role !== 'assistant') return true
  // Text-then-tools is still the silent next hop. JSONL stores that as
  // content+finished tools, which looks settled and must not close the wait.
  if (assistantEndedAwaitingModel(liveLast)) return false
  if ((liveLast.content ?? '').trim() !== (historyLast.content ?? '').trim()) return false
  return Boolean(liveLast.streaming)
}

function streamingAssistantToolsAllFinished(messages: ChatMessage[]): boolean {
  const last = [...messages].reverse().find(message => message.role === 'assistant' && message.streaming)
  const tools = last?.tools ?? []
  return tools.length > 0 && tools.every(tool => Boolean(tool.finished))
}

/** A `[subagent-*]` injection — already in the transcript or still pending on
 *  the just-emitted `started` — is a follow-up wait, not a leftover first-token
 *  or generic "等待模型响应" after the worker card already says 已完成. */
function waitingPhaseForTurn(messages: ChatMessage[], pendingFollowUps?: string[]): WaitingPhase {
  const lastUser = [...messages].reverse().find(message => message.role === 'user')
  if (lastUser && parseSubagentSignal(lastUser.content)) return 'followup'
  if (pendingFollowUps?.some(text => parseSubagentSignal(text))) return 'followup'
  return hasVisibleAssistantOutput(messages) ? 'continuing' : 'awaiting'
}

/** A terminal from another host epoch must not close the turn now on screen. */
function staleTurnTerminal(event: Extract<StreamEvent, { type: 'status' }>, openedEpoch?: number): boolean {
  return (event.status === 'settled' || event.status === 'stopped')
    && event.turnEpoch !== undefined
    && openedEpoch !== undefined
    && event.turnEpoch !== openedEpoch
}

/** A `started` after a finished assistant is real when it advances the backend
 *  epoch or a new prompt is already visible/queued. Otherwise bare started is
 *  the ghost-turn path, except when the last assistant ended on tools — that is
 *  the next silent model hop (Grok/xhigh often omits thinking_delta). */
function shouldOpenWaitOnStarted(messages: ChatMessage[], pendingFollowUps?: string[], turnEpoch?: number, openedEpoch?: number): boolean {
  if (turnEpoch !== undefined && openedEpoch !== undefined && turnEpoch > openedEpoch) return true
  if (pendingFollowUps?.some(text => text.trim().length > 0)) return true
  const last = messages[messages.length - 1]
  if (!last) return true
  if (last.role === 'user') return true
  if (last.role === 'assistant' && Boolean(last.streaming)) return true
  return last.role === 'assistant' && assistantEndedAwaitingModel(last)
}

/** After a closed turn these kinds are transcript projections, not a Boss wake. */
function isSettledSubagentProjection(signal: { kind: string } | null | undefined): boolean {
  return signal?.kind === 'done' || signal?.kind === 'heartbeat' || signal?.kind === 'stalled'
}

/** Queue-drain text and already-running turns still open processing. A late
 *  terminal/heartbeat/stalled `[subagent-*]` after idle must wait for `started`. */
function shouldOpenTurnOnUserMessage(content: string, alreadyRunning: boolean): boolean {
  const signal = parseSubagentSignal(content)
  if (isSettledSubagentProjection(signal) && !alreadyRunning) return false
  return Boolean(signal || content.trim())
}

function ResizeHandle({ label, side, onPointerDown }: { label: string; side?: 'left' | 'right'; onPointerDown: (event: React.PointerEvent) => void }) { return <div className={`resize-handle${side ? ` resize-handle-${side}` : ''}`} role="separator" aria-label={label} onPointerDown={onPointerDown} /> }
function RightPaneToggleIcon({ expanded }: { expanded: boolean }) {
  return expanded
    ? <svg className="right-pane-toggle-icon" data-pane-icon="collapse" aria-hidden="true" viewBox="0 0 20 20"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path className="right-pane-toggle-fill" d="M11 3h4.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H11z" /><path d="M9.5 10h5m-2-2 2 2-2 2" /></svg>
    : <svg className="right-pane-toggle-icon" data-pane-icon="expand" aria-hidden="true" viewBox="0 0 20 20"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M11.5 3v14" /><path d="M14.5 7.5v5" /></svg>
}
function ChatHeader({ session, project, lease, host, gitAvailable, sidebarCollapsed, toolsCollapsed, onToggleSidebar, onToggleTools, onRename, onTakeover, externalReadOnly, externalSource, canAdoptExternal, adoptDisabledReason, adopting, adoptError, onDismissAdoptError, onAdoptExternal, onViewOriginal }: { session?: Session; project?: Project; lease: SessionLease | null; host: PipiHostAPI; gitAvailable: boolean; sidebarCollapsed: boolean; toolsCollapsed: boolean; onToggleSidebar: () => void; onToggleTools: () => void; onRename: (sessionId: string, title: string) => Promise<void> | void; onTakeover: () => void; externalReadOnly?: boolean; externalSource?: string; canAdoptExternal?: boolean; adoptDisabledReason?: string; adopting?: boolean; adoptError?: string | null; onDismissAdoptError?: () => void; onAdoptExternal?: () => void; onViewOriginal?: () => void }) {
  const [renaming, setRenaming] = useState(false)
  useEffect(() => setRenaming(false), [session?.id])
  const readOnly = Boolean(externalReadOnly) || (lease !== null && !leaseCanWrite(lease))
  const canRename = Boolean(session) && !externalReadOnly
  return <header className="chat-header">{sidebarCollapsed && <button className="pane-toggle pane-restore pane-restore-sidebar" data-testid="toggle-sidebar" title="展开左栏" aria-label="展开左栏" aria-expanded="false" onClick={onToggleSidebar}>≡</button>}<div className="chat-header-title">{renaming && canRename && session ? <InlineSessionTitleEditor value={session.name} ariaLabel="会话名称" className="chat-header-title-input" onCommit={async title => { await onRename(session.id, title); setRenaming(false) }} onCancel={() => setRenaming(false)} /> : <strong className="chat-header-title-label" role={canRename ? 'button' : undefined} tabIndex={canRename ? 0 : undefined} title={externalReadOnly ? `${sessionSourceLabel(externalSource)} · 只读` : session ? '双击修改会话名称' : undefined} onDoubleClick={() => { if (canRename) setRenaming(true) }} onKeyDown={event => { if (canRename && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); setRenaming(true) } }}>{session?.name ?? 'PipiUI'}</strong>}{externalReadOnly && <span className="lease-detail" data-testid="external-session-readonly">{sessionSourceLabel(externalSource)} 会话 · 只读{canAdoptExternal && onAdoptExternal ? <button type="button" data-testid="adopt-external-session" disabled={adopting} onClick={onAdoptExternal}>{adopting ? '正在接管…' : '用 Pi 继续'}</button> : adoptDisabledReason ? <span data-testid="adopt-external-unavailable">{adoptDisabledReason}</span> : null}</span>}{session?.adoptedFrom && onViewOriginal && <button type="button" className="lease-detail" data-testid="view-original-record" onClick={onViewOriginal}>查看原始记录</button>}{adoptError && <span className="lease-detail" data-testid="adopt-external-error" role="alert">{adoptError}{onDismissAdoptError && <button type="button" aria-label="关闭接管错误" onClick={onDismissAdoptError}>×</button>}</span>}{readOnly && !externalReadOnly && <span className="lease-detail">由 {leaseOwnerLabel(lease)} 运行中 · 只读 <button data-testid="lease-takeover-header" onClick={onTakeover}>强制接管</button></span>}</div><div className="chat-header-actions"><GitBranchMenu host={host} projectId={project?.id} available={gitAvailable} />{toolsCollapsed && <button className="pane-toggle" data-testid="toggle-tools" title="展开右栏" aria-label="展开右栏" aria-expanded="false" onClick={onToggleTools}><RightPaneToggleIcon expanded={false} /></button>}</div></header>
}
const MIN_COMPOSER_HEIGHT = 29
const MAX_COMPOSER_HEIGHT = 150
/** jsdom has no layout engine (scrollHeight is 0), so fall back to a line-based estimate there. */
function estimatedTextareaHeight(value: string): number {
  const lines = value ? value.split('\n').length : 1
  return Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, lines * 29))
}

type ComposerAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  /** Object URL for preview; revoked on remove / App unmount / successful send. */
  url: string
  /** Pasted/clipboard attachment; base64 is read at send time only. */
  file: File
}

type ComposerDocument = {
  id: string
  name: string
  path: string
}

/** Shared empty list so no render allocates a fresh array for the default. */
const EMPTY_COMPOSER_ATTACHMENTS: ComposerAttachment[] = []
const EMPTY_COMPOSER_DOCUMENTS: ComposerDocument[] = []

function toPromptAttachment(a: ComposerAttachment): Promise<PromptAttachment> {
  return fileToPromptAttachment(a.file).catch(() => { throw new Error('无法读取图片') })
}

function Composer({ streaming, working, stopping, stopError, compacting, queueBusy, readOnly, leaseOwner, onTakeover, readOnlyMessage, hideSessionChrome, modelState, host, sessionId, initialDraft = '', initialAttachments = EMPTY_COMPOSER_ATTACHMENTS, initialDocuments = EMPTY_COMPOSER_DOCUMENTS, onDraftChange, onAttachmentsChange, onDocumentsChange, statsRefreshKey, visibility, onOpenModelManager, onCompact, onSend, onStop, onDismissStopError, onModel, onEnsureSession, onOpenBrowserLogin, visionEnabled, visionModelRef }: { streaming: boolean; working: boolean; stopping: boolean; stopError: string | null; compacting: boolean; queueBusy: boolean; readOnly: boolean; leaseOwner?: string; onTakeover?: () => void; readOnlyMessage?: string; hideSessionChrome?: boolean; modelState: ModelState | null; host: PipiHostAPI; sessionId: string; initialDraft?: string; initialAttachments?: ComposerAttachment[]; initialDocuments?: ComposerDocument[]; onDraftChange?: (draft: string) => void; onAttachmentsChange?: (attachments: ComposerAttachment[]) => void; onDocumentsChange?: (documents: ComposerDocument[]) => void; statsRefreshKey: number; visibility: ModelVisibilityController; onOpenModelManager: () => void; onCompact: () => void; onSend: (draft: string, attachments?: ComposerAttachment[], documents?: ComposerDocument[]) => Promise<boolean>; onStop: () => void; onDismissStopError: () => void; onModel: (state: ModelState) => void; onEnsureSession: () => Promise<string | null>; onOpenBrowserLogin?: () => void; visionEnabled: boolean; visionModelRef: string | null }) {
  const [draft, setDraft] = useState(initialDraft)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(initialAttachments)
  const [documents, setDocuments] = useState<ComposerDocument[]>(initialDocuments)
  const [draftSessionId, setDraftSessionId] = useState(sessionId)
  if (sessionId !== draftSessionId) {
    setDraftSessionId(sessionId)
    setDraft(initialDraft)
    setAttachments(initialAttachments)
    setDocuments(initialDocuments)
  }
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashHidden, setSlashHidden] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Session switch resets composer chrome only. Attachments (and their object
  // URLs) belong to the session in the parent's attachmentsBySessionRef; they
  // are restored from there when this session is selected again and must never
  // be revoked here, or a parked session's thumbnails would die on switch.
  useEffect(() => {
    setLightboxIndex(null)
    setAttachError(null)
    setSendError(null)
    setQuickOpen(false)
  }, [sessionId])
  // Esc closes the lightbox and the quick menu.
  useEffect(() => {
    if (lightboxIndex === null && !quickOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setLightboxIndex(null); setQuickOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, quickOpen])

  const slashQuery = slashPaletteQuery(draft)
  const registeredSlashCommands = useSlashCommands()
  const slashMatches = useMemo(() => (slashQuery === null ? [] : filterSlashCommands(slashQuery)), [slashQuery, registeredSlashCommands])
  const slashVisible = slashQuery !== null && !slashHidden

  useEffect(() => { setSlashIndex(0) }, [slashQuery])
  useEffect(() => { setSlashIndex(i => Math.min(i, Math.max(0, slashMatches.length - 1))) }, [slashMatches.length])
  // Auto-grow: typing, paste, deletion and programmatic clears all flow through `draft`.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const measured = el.scrollHeight > 0 ? el.scrollHeight : estimatedTextareaHeight(draft)
    el.style.height = `${Math.min(measured, MAX_COMPOSER_HEIGHT)}px`
  }, [draft])

  const persistDraft = (value: string) => { setDraft(value); onDraftChange?.(value) }
  const changeDraft = (value: string) => { persistDraft(value); setSlashHidden(false) }
  const dismissSlash = () => setSlashHidden(true)
  const executeSlash = (command: SlashCommandDef) => {
    setSlashHidden(true)
    if (command.action.kind === 'open-model-manager') {
      onOpenModelManager()
      persistDraft('') // Swift executeSlash clears the draft before running the command
    } else if (command.action.kind === 'compact') {
      onCompact()
      persistDraft('')
    } else if (command.action.kind === 'send-plan' || command.action.kind === 'send-prompt') {
      const invocation = parseSlashInvocation(draft)
      const args = invocation?.name === command.name ? invocation.args : ''
      const outgoing = command.action.kind === 'send-plan'
        ? planPromptFromArgs(args)
        : (draft.trim() || `/${command.name}`)
      void dispatchSend(outgoing)
    }
  }

  const removeAttachment = (id: string) => {
    if (readOnly) return
    const next = attachments.filter(a => a.id !== id)
    const target = attachments.find(a => a.id === id)
    if (target) URL.revokeObjectURL(target.url)
    setAttachments(next)
    onAttachmentsChange?.(next)
    if (lightboxIndex !== null) setLightboxIndex(null)
  }
  const addFiles = (files: File[]) => {
    if (readOnly || !files.length) return
    let firstError: string | null = null
    const accepted: ComposerAttachment[] = []
    for (const file of files) {
      const problem = validateAttachment(file)
      if (problem) { firstError ??= problem; continue }
      accepted.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, url: URL.createObjectURL(file), file })
    }
    if (accepted.length) {
      const next = [...attachments, ...accepted]
      setAttachments(next)
      onAttachmentsChange?.(next)
    }
    if (firstError) setAttachError(firstError)
  }
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    const files = imageFilesFromClipboard(event.clipboardData)
    if (files.length) { event.preventDefault(); setAttachError(null); addFiles(files) }
  }
  const addDocuments = (paths: string[]) => {
    if (readOnly || !paths.length) return
    const existing = new Set(documents.map(document => document.path))
    const accepted: ComposerDocument[] = []
    for (const path of paths) {
      if (existing.has(path)) continue
      existing.add(path)
      accepted.push({ id: crypto.randomUUID(), name: composerDocumentName(path) || path, path })
    }
    if (!accepted.length) return
    const next = [...documents, ...accepted]
    setDocuments(next)
    onDocumentsChange?.(next)
  }
  const removeDocument = (id: string) => {
    if (readOnly) return
    const next = documents.filter(document => document.id !== id)
    setDocuments(next)
    onDocumentsChange?.(next)
  }
  const onComposerFileDrag = (event: DragEvent) => {
    if (!fileDragHasFiles(event)) return
    consumeFileDropEvent(event)
  }
  const onComposerFileDrop = (event: DragEvent) => {
    if (!fileDragHasFiles(event)) return
    if (readOnly) {
      ignoreComposerFileDrag(event)
      return
    }
    const getPath = typeof window !== 'undefined' ? window.pipiPathForFile : undefined
    if (!getPath) {
      ignoreComposerFileDrag(event)
      return
    }
    const paths = supportedDocumentPathsFromFiles(event.dataTransfer?.files ?? [], getPath)
    if (!paths.length) {
      ignoreComposerFileDrag(event)
      return
    }
    consumeFileDropEvent(event)
    addDocuments(paths)
  }

  const dispatchSend = async (outgoing: string) => {
    if (readOnly) return
    const hasText = outgoing.trim() !== ''
    if (!hasText && attachments.length === 0 && documents.length === 0) return
    if (attachments.length > 0 && modelState?.model && modelState.model.supportsImages === false) {
      // 识图路由开启且已选识图模型时放行：图片交给识图模型识别后路由给主线文字模型
      // （后端负责 describe+route，UI 只负责不拦截）。否则保持原拦截提示。
      if (!(visionEnabled && visionModelRef !== null)) {
        setSendError(`当前模型 ${modelState.model.name} 不支持图片附件`)
        return
      }
    }
    setSendError(null)
    const outgoingAttachments = attachments.slice()
    const outgoingDocuments = documents.slice()
    // Clear immediately. sendPrompt/enqueue can sit on ensure+RPC for seconds
    // while the optimistic bubble is already visible; waiting to clear after
    // that promise leaves the same text in the composer.
    persistDraft('')
    setAttachments([])
    onAttachmentsChange?.([])
    setDocuments([])
    onDocumentsChange?.([])
    setAttachError(null)
    try {
      const ok = await onSend(outgoing, outgoingAttachments.length ? outgoingAttachments : undefined, outgoingDocuments.length ? outgoingDocuments : undefined)
      if (!ok) {
        persistDraft(outgoing)
        setAttachments(outgoingAttachments)
        onAttachmentsChange?.(outgoingAttachments)
        setDocuments(outgoingDocuments)
        onDocumentsChange?.(outgoingDocuments)
        return
      }
      for (const attachment of outgoingAttachments) URL.revokeObjectURL(attachment.url)
    } catch (err) {
      persistDraft(outgoing)
      setAttachments(outgoingAttachments)
      onAttachmentsChange?.(outgoingAttachments)
      setDocuments(outgoingDocuments)
      onDocumentsChange?.(outgoingDocuments)
      setSendError(`发送失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const submit = async () => {
    if (readOnly) return
    const invocation = parseSlashInvocation(draft)
    const command = invocation ? slashCommandByName(invocation.name) : undefined
    if (command) { executeSlash(command); return }
    await dispatchSend(draft.trim() !== '' ? draft : '')
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (slashVisible) { event.preventDefault(); dismissSlash() }
      return
    }
    if (event.key === 'ArrowDown' && slashVisible && slashMatches.length) { event.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashMatches.length - 1)); return }
    if (event.key === 'ArrowUp' && slashVisible && slashMatches.length) { event.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return }
    if (event.key === 'Tab' && slashVisible && slashMatches.length) { event.preventDefault(); persistDraft(`/${slashMatches[Math.min(slashIndex, slashMatches.length - 1)].name} `); setSlashHidden(true); return }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (slashVisible && slashMatches.length > 0) { executeSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return }
      void submit()
    }
  }
  const setThinking = async (level: ThinkingLevel) => {
    const previous = modelState
    if (previous) onModel({ ...previous, thinkingLevel: level })
    try {
      const targetSession = sessionId || await onEnsureSession()
      if (!targetSession) throw new Error('没有可用会话')
      onModel(await host.setThinkingLevel(targetSession, level))
      setSendError(null)
    } catch (err) {
      if (previous) onModel(previous)
      setSendError(`切换思考级别失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const handleQuickSelect = async (model: Model) => {
    setQuickOpen(false)
    const previous = modelState
    const availableThinkingLevels = thinkingLevelsForModel(model)
    onModel({
      model,
      thinkingLevel: resolveThinkingLevel(previous?.thinkingLevel, availableThinkingLevels) ?? 'off',
      availableThinkingLevels,
    })
    try {
      const targetSession = sessionId || await onEnsureSession()
      if (!targetSession) throw new Error('没有可用会话')
      onModel(await host.setModel(targetSession, model.provider, model.id))
      setSendError(null)
    } catch (err) {
      if (previous) onModel(previous)
      setSendError(`切换模型失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const canSend = !readOnly && (draft.trim() !== '' || attachments.length > 0 || documents.length > 0)
  const showQueueSubmit = queueBusy && canSend
  return <footer className="composer" onDragEnter={onComposerFileDrag} onDragOver={onComposerFileDrag} onDrop={onComposerFileDrop}>
    {readOnly && <div className="composer-read-only" data-testid="composer-read-only" role="status"><span>{readOnlyMessage ?? `当前由 ${leaseOwner ?? '另一客户端'} 持有，会话只读。`}</span>{onTakeover && <button type="button" data-testid="composer-lease-takeover" onClick={onTakeover}>强制接管</button>}</div>}
    {slashVisible && <SlashMenu commands={slashMatches} selectedIndex={Math.min(slashIndex, Math.max(0, slashMatches.length - 1))} onHighlight={setSlashIndex} onSelect={executeSlash} onDismiss={dismissSlash} />}
    {attachments.length > 0 && <div className="composer-thumbs" data-testid="composer-thumbs">
      {attachments.map((attachment, index) => (
        <div key={attachment.id} className="composer-thumb" data-testid={`composer-thumb-${index}`}>
          <img src={attachment.url} alt={attachment.name} onClick={() => setLightboxIndex(index)} />
          <button className="composer-thumb-remove" aria-label={`移除图片 ${attachment.name}`} disabled={readOnly} onClick={() => removeAttachment(attachment.id)}>×</button>
        </div>
      ))}
    </div>}
    {documents.length > 0 && <div className="composer-doc-chips" data-testid="composer-doc-chips">
      {documents.map((document, index) => (
        <div key={document.id} className="composer-doc-chip" data-testid={`composer-doc-chip-${index}`} title={document.path}>
          <span className="composer-doc-chip-name">{document.name}</span>
          <button className="composer-doc-chip-remove" aria-label={`移除文件 ${document.name}`} disabled={readOnly} onClick={() => removeDocument(document.id)}>×</button>
        </div>
      ))}
    </div>}
    {(attachError || sendError || stopError) && <div className="composer-error" data-testid="composer-error"><span>{stopError ?? sendError ?? attachError}</span><button className="composer-error-close" aria-label="关闭错误提示" data-testid="composer-error-close" onClick={() => { setSendError(null); setAttachError(null); onDismissStopError() }}>×</button></div>}
    <div className="composer-card"><div className="composer-shell"><textarea ref={textareaRef} aria-label="消息输入框" disabled={readOnly} value={draft} placeholder={readOnly ? '会话由另一版本运行中' : queueBusy ? '当前会话忙碌，发送将加入队列…' : '给 PipiUI 发送消息…'} rows={1} onChange={event => changeDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />{working && <button aria-label={stopping ? '正在停止' : '停止生成'} className="send stop" disabled={stopping} onClick={onStop}>{stopping ? '…' : '■'}</button>}<button aria-label={showQueueSubmit ? '加入消息队列' : '发送消息'} className="send" disabled={!canSend} onClick={() => void submit()}>↑</button></div></div>
    <div className="composer-options"><div className="composer-options-left">{!hideSessionChrome && <><div className="quick-menu-anchor"><button className="model-chip" aria-label="当前模型" title="切换模型" data-testid="model-chip" disabled={readOnly} onClick={() => { if (!readOnly) setQuickOpen(value => !value) }}>{modelState?.model && <ProviderLogo provider={modelState.model.provider} modelId={modelState.model.id} size={13} />}<span className="model-chip-name">{modelState?.model.name ?? '加载模型…'}</span></button>{quickOpen && !readOnly && <ModelQuickMenu groups={visibility.quickGroups} current={modelState?.model ?? null} onSelect={model => void handleQuickSelect(model)} onClose={() => setQuickOpen(false)} />}</div><ThinkingChip level={modelState?.thinkingLevel ?? 'off'} levels={modelState?.availableThinkingLevels ?? []} onChange={level => void setThinking(level)} /></>}</div>{!hideSessionChrome && <div className="composer-stats" data-testid="composer-session-stats"><SessionStatsPill host={host} sessionId={sessionId} isStreaming={streaming} isCompacting={compacting} refreshKey={statsRefreshKey} /><QuotaPill host={host} sessionId={sessionId} provider={modelState?.model.provider} modelId={modelState?.model.id} refreshKey={statsRefreshKey} onOpenBrowserLogin={onOpenBrowserLogin} /><BalancePill host={host} sessionId={sessionId} provider={modelState?.model.provider} refreshKey={statsRefreshKey} /></div>}</div>
    {lightboxIndex !== null && attachments[lightboxIndex] && <div className="lightbox-backdrop" data-testid="lightbox" onMouseDown={event => { if (event.target === event.currentTarget) setLightboxIndex(null) }}><img src={attachments[lightboxIndex].url} alt="图片预览" /><button className="lightbox-close" aria-label="关闭预览" onClick={() => setLightboxIndex(null)}>×</button></div>}
  </footer>
}
function ToolQuickRail({ variant, activeTab, toolsCollapsed, onSelect, host, browserAvailable, terminalAvailable, planTabVisible, planProgress, subagentsRunningCount }: { variant: 'header' | 'float'; activeTab: PanelTab; toolsCollapsed: boolean; onSelect: (tab: PanelTab) => void; host: PipiHostAPI; browserAvailable: boolean | undefined; terminalAvailable: boolean | undefined; planTabVisible: boolean; planProgress: { completed: number; total: number } | null; subagentsRunningCount: number }) {
  const panels = usePanels()
  const railCtx: PanelRailContext = { host, browserAvailable, terminalAvailable, planTabVisible, planProgress, subagentsRunningCount }
  return <nav className={`tool-quick-rail tool-quick-rail-${variant}`} aria-label="工具面板" data-testid="tool-quick-rail">
    {panels.map(panel => {
      if (panel.visibleInRail && !panel.visibleInRail(railCtx)) return null
      const unavailableTitle = panel.railUnavailable?.(railCtx)
      const unavailable = Boolean(unavailableTitle)
      const active = activeTab === panel.id && !toolsCollapsed
      return <button key={panel.id} className={`tool-rail-button${active ? ' active' : ''}`} aria-label={panel.id} aria-current={active ? 'page' : undefined} aria-disabled={unavailable || undefined} disabled={unavailable} title={unavailable ? unavailableTitle : panel.id} onClick={() => onSelect(panel.id)}>
        <span className="tool-rail-icon" aria-hidden="true" style={{ width: 13 * panel.icon.ratio, WebkitMaskImage: `url(${panel.icon.src})`, maskImage: `url(${panel.icon.src})` }} />
        {panel.railBadge?.(railCtx)}
      </button>
    })}
  </nav>
}
function ToolPanel({ activeTab, collapsed, onToggleCollapsed, rail, canGoBack, onBack, host, theme, sessionId, announcedTerminal, revealedTerminalId, onSubagentsRunningCountChange, onSubagentStarted, onManualSubagentStatusCheck, browserAvailable, browserOccluded, terminalAvailable, planAvailable, onPlanProgressChange, onHasPlansChange, retainedWorktreeDispositionAvailable, projectId, projectPath, openedDocumentPath, onOpenDocument, onDropDocuments, workspaceFullscreen = false, onToggleWorkspaceFullscreen }: { activeTab: PanelTab; collapsed: boolean; onToggleCollapsed: () => void; rail?: ReactNode; canGoBack: boolean; onBack: () => void; host: PipiHostAPI; theme: 'light' | 'dark'; sessionId?: string; announcedTerminal?: TerminalSession; revealedTerminalId?: string; onSubagentsRunningCountChange: (count: number) => void; onSubagentStarted: () => void; onManualSubagentStatusCheck: (agentIDs: string[]) => void; browserAvailable: boolean | undefined; browserOccluded: boolean; terminalAvailable: boolean | undefined; planAvailable: boolean | undefined; onPlanProgressChange: (progress: { completed: number; total: number } | null) => void; onHasPlansChange: (sessionId: string, hasPlans: boolean) => void; retainedWorktreeDispositionAvailable: boolean; projectId?: string; projectPath?: string; openedDocumentPath?: string | null; onOpenDocument: (path: string) => void; onDropDocuments: (paths: string[]) => void; workspaceFullscreen?: boolean; onToggleWorkspaceFullscreen?: () => void }) {
  const panels = usePanels()
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null)
  const [mountedIds, setMountedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const panel of panels) {
      if (!panel.lazy || panel.id === activeTab) initial.add(panel.id)
    }
    return initial
  })
  const [dropActive, setDropActive] = useState(false)
  const dropDepthRef = useRef(0)
  useEffect(() => {
    setMountedIds(current => current.has(activeTab) ? current : new Set(current).add(activeTab))
  }, [activeTab])
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return
    consumeFileDropEvent(event)
    dropDepthRef.current += 1
    setDropActive(true)
  }
  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return
    consumeFileDropEvent(event)
  }
  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return
    consumeFileDropEvent(event)
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
    if (dropDepthRef.current === 0) setDropActive(false)
  }
  const onDrop = (event: DragEvent) => {
    consumeFileDropEvent(event)
    dropDepthRef.current = 0
    setDropActive(false)
    const getPath = typeof window !== 'undefined' ? window.pipiPathForFile : undefined
    if (!getPath) return
    onDropDocuments(supportedDocumentPathsFromFiles(event.dataTransfer.files, getPath))
  }
  return <aside className={`tool-panel${dropActive ? ' drop-target' : ''}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
    <div className="tool-panel-drop-overlay" aria-hidden="true" />
    {!collapsed && <header className="tool-panel-header">{rail}{canGoBack && <button type="button" className="tool-panel-back" data-testid="tool-panel-back" aria-label="返回上一栏" onClick={onBack}>‹ 返回</button>}<div className="tool-panel-header-slot" ref={el => setHeaderSlot(el)} /><button className="pane-toggle" data-testid="toggle-tools" title="收起右栏" aria-label="收起右栏" aria-expanded="true" onClick={onToggleCollapsed}><RightPaneToggleIcon expanded /></button></header>}
    <div className="tool-content">
      {panels.map(panel => {
        if (panel.lazy && !mountedIds.has(panel.id) && panel.id !== activeTab) return null
        return <Fragment key={panel.id}>{panel.render({
          host, theme, sessionId, collapsed, active: activeTab === panel.id, headerSlot,
          announcedTerminal, revealedTerminalId, onSubagentsRunningCountChange, onSubagentStarted,
          onManualSubagentStatusCheck, browserAvailable, browserOccluded, terminalAvailable, planAvailable,
          onPlanProgressChange, onHasPlansChange, retainedWorktreeDispositionAvailable, projectId, projectPath,
          openedDocumentPath, onOpenDocument, workspaceFullscreen, onToggleWorkspaceFullscreen,
        })}</Fragment>
      })}
    </div>
  </aside>
}
