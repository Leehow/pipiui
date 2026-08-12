import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { SubagentPanel } from './SubagentPanel'
import { DocumentPanel, mockDocumentContents } from './DocumentPanel'
import { TerminalPanel } from './TerminalPanel'
import { BrowserPanel } from './BrowserPanel'
import { ActivityCard as CollapsibleActivityCard } from './ActivityCard'
import { AssistantTranscriptContent, type TranscriptTool } from './AssistantTranscriptContent'
import type { AgentDefinition, AgentSummary, BrowserEvent, BrowserHostAPI, BrowserSnapshot, BrowserTab, BrowserTabsSnapshot, BrowserViewBounds, DocumentContent, GitStatus, HistoryEntry, Model, ModelState, PipiHostAPI, Project, PromptAttachment, Session, SessionLease, StreamEvent, SubagentModelSetting, TerminalEvent, TerminalSession, ThinkingLevel } from '@pipi/host-api'
import { ModelVisibilityModal } from './ModelVisibilityModal'
import { ComputerUsePanel } from './ComputerUsePanel'
import { RemoteConnectionPanel } from './RemoteConnectionPanel'
import { SubagentModelModal } from './SubagentModelModal'
import { ModelQuickMenu } from './ModelQuickMenu'
import { GitBranchMenu } from './GitBranchMenu'
import { ProviderLogo } from './ProviderLogo'
import { Sidebar, type ProjectMenuAction, type ProjectMenuUnavailable, type SidebarProject, type SidebarSession, type SessionStatus } from './Sidebar'
import { SlashMenu } from './SlashMenu'
import personGroupIcon from './sf-icons/person-2.png'
import globeIcon from './sf-icons/globe.png'
import docTextIcon from './sf-icons/doc-text.png'
import terminalIcon from './sf-icons/terminal.png'
import { ThinkingChip } from './thinking-chip'
import { WaitingPlaceholder, type WaitingPhase } from './WaitingPlaceholder'
import { StreamEventCoalescer } from './StreamEventCoalescer'
import { QuotaPill } from './QuotaPill'
import { BalancePill } from './BalancePill'
import { SessionStatsPill } from './SessionStatsPill'
import { PromptRail, useActivePromptId } from './PromptRail'
import { MessageQueue } from './MessageQueue'
import { useSessionQueue } from './useSessionQueue'
import { UserMessageBubble } from './UserMessageBubble'
import { MessageActionBar } from './MessageActionBar'
import { buildRailPrompts } from './prompt-rail'
import { parseSubagentNotice } from './subagent-notice'
export { parseSubagentNotice } from './subagent-notice'
import { compactionNotice } from './compaction-notice'
import { filterSlashCommands, parseSlashInvocation, slashCommandByName, slashPaletteQuery, type SlashCommandDef } from './slash-commands'
import { useModelVisibility, type ModelVisibilityController } from './useModelVisibility'
import { fileToPromptAttachment, imageFilesFromClipboard, validateAttachment } from './attachments'
import './app.css'
import './message-actions.css'
import './subagent.css'

type ToolCard = TranscriptTool
export type ChatMessage = { id: string; role: 'user' | 'assistant' | 'tool'; content: string; thinking?: string; tools?: ToolCard[]; streaming?: boolean; timestamp?: number }
type PanelTab = 'Subagents' | 'Browser' | 'Document' | 'Terminal'
type PaneWidths = { sidebar: number; tools: number; sidebarCollapsed: boolean; toolsCollapsed: boolean }
type SidebarPreferences = { expandedIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[]; visibleLimit: number }
type SessionWithSidebarMetadata = Session & { provider?: unknown; modelId?: unknown; modelRef?: unknown; model?: unknown }
type RuntimeSessionLease = SessionLease & { canWrite?: unknown; ownerLabel?: unknown }

/** Accept both the current host-api shape and lease payloads from older running Electron hosts. */
export function leaseCanWrite(lease: SessionLease | null): boolean {
  if (!lease) return false
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

const tabs: PanelTab[] = ['Subagents', 'Browser', 'Document', 'Terminal']
/** SF Symbols parity tool-rail glyphs (Swift panelQuickRail: person.2/globe/doc.text/terminal).
 *  Rendered from system-exported SF Symbols bitmaps via CSS mask, so the icon shape matches
 *  Swift's `systemName` glyphs exactly and the color follows `currentColor` (accent when active). */
const toolRailIcons: Record<PanelTab, { src: string; ratio: number }> = {
  Subagents: { src: personGroupIcon, ratio: 70 / 49 },
  Browser: { src: globeIcon, ratio: 46 / 46 },
  Document: { src: docTextIcon, ratio: 44 / 49 },
  Terminal: { src: terminalIcon, ratio: 57 / 43 },
}
const defaultWidths: PaneWidths = { sidebar: 258, tools: 368, sidebarCollapsed: false, toolsCollapsed: false }
const storageKey = 'pipiui:eui-pane-widths'
const sidebarPreferencePrefix = 'pipiui:eui:sidebar:v1'
const sidebarSemanticMigrationKey = 'pipiui:eui:sidebar-semantic-host:v1'
export const SIDEBAR_PROJECT_PAGE_SIZE = 6
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

function readSidebarPreferences(key: string): SidebarPreferences | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const candidate = value as { expandedIds?: unknown; pinnedSessionIds?: unknown; archivedSessionIds?: unknown; visibleLimit?: unknown }
    const visibleLimit = typeof candidate.visibleLimit === 'number' && Number.isFinite(candidate.visibleLimit)
      ? Math.max(1, Math.floor(candidate.visibleLimit))
      : SIDEBAR_PROJECT_PAGE_SIZE
    return { expandedIds: stringArray(candidate.expandedIds), pinnedSessionIds: stringArray(candidate.pinnedSessionIds), archivedSessionIds: stringArray(candidate.archivedSessionIds), visibleLimit }
  } catch { return null }
}

function writeSidebarPreferences(key: string, preferences: SidebarPreferences) {
  try { localStorage.setItem(key, JSON.stringify(preferences)) } catch { /* storage can be disabled by the host */ }
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Read optional future session metadata without widening the host-api v2 contract. */
export function sidebarModelForSession(session: Session, selectedSessionId: string, currentModel: Model | null): { provider: string; modelId?: string } {
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
  // The selected live session is the only one for which App has a verified current model.
  if (session.id === selectedSessionId && currentModel) {
    provider ??= currentModel.provider
    modelId ??= currentModel.id
  }
  return { provider: provider ?? '', modelId }
}

/** Build an immediate display snapshot from listSessions metadata. */
function modelStateFromSession(session: Session | undefined, catalog: readonly Model[]): ModelState | null {
  if (!session) return null
  const ref = sidebarModelForSession(session, '', null)
  if (!ref.provider || !ref.modelId) return null
  const known = catalog.find(model => model.provider === ref.provider && model.id === ref.modelId)
  const model: Model = known ?? { provider: ref.provider, id: ref.modelId, name: ref.modelId, reasoning: false }
  return {
    model,
    thinkingLevel: 'off',
    availableThinkingLevels: model.reasoning ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['off']
  }
}

/** Swift-style priority: main stream > session-bound subagents > terminal agent states > observed stream state > idle. */
export function sidebarStatusForSession(sessionId: string, selectedSessionId: string, streaming: boolean, observedStatus: SessionStatus | undefined, agents: readonly AgentSummary[]): { status: SessionStatus; subagentCount?: number } {
  if ((sessionId === selectedSessionId && streaming) || observedStatus === 'running') return { status: 'running' }
  const linked = agents.filter(agent => agent.sessionId === sessionId)
  const runningCount = linked.filter(agent => agent.state === 'running').length
  if (runningCount > 0) return { status: 'subagents-running', subagentCount: runningCount }
  if (linked.some(agent => agent.state === 'failed')) return { status: 'failed' }
  if (linked.some(agent => agent.stalled || agent.state === 'stalled')) return { status: 'stalled' }
  if (linked.some(agent => agent.state === 'interrupted' || agent.state === 'aborted')) return { status: 'interrupted' }
  if (observedStatus && observedStatus !== 'idle') return { status: observedStatus }
  if (linked.some(agent => agent.state === 'ok')) return { status: 'completed' }
  return { status: 'idle' }
}

function readWidths(): PaneWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '') as Partial<PaneWidths>
    return {
      sidebar: clamp(parsed.sidebar ?? defaultWidths.sidebar, 190, 440),
      tools: clamp(parsed.tools ?? defaultWidths.tools, 270, 620),
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
      { id: 'a1', role: 'assistant', content: '我会先检查现有结构，然后完成 UI。\n\n```tsx\nexport function App() {\n  return <MainLayout />\n}\n```', timestamp: Date.now() - 50_000 }
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
  // Subagent fixtures are per-session, mirroring the real backend's
  // `filter(agent => !sessionId || agent.sessionId === sessionId)`:
  // switching sessions in the right panel shows that session's own tree.
  const mockAgents: AgentSummary[] = [
    { agentId: 'research', runId: 'mock-1', sessionId: 'welcome', name: 'explore', role: 'explore', title: '调研 UI', task: '调研 Electron UI 结构', state: 'running', depth: 1, createdAt: Date.now() - 20_000, cost: 0.03, costUnit: 'CNY', exchangeRate: 7.2, turns: 2, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', contextTokens: 38_200, contextWindowTokens: 200_000, inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900, listSubtitle: '正在梳理右侧面板组件边界' },
    { agentId: 'review', runId: 'mock-2', sessionId: 'welcome', parentId: 'research', name: 'reviewer', role: 'review', title: '检查实现', task: '检查三栏实现', state: 'failed', depth: 2, createdAt: Date.now() - 10_000, endedAt: Date.now() - 2_000, cost: 0.01, costUnit: 'CNY', exchangeRate: 7.2, turns: 1, provider: 'openai', model: 'openai/gpt-5', contextTokens: 9_700, contextWindowTokens: 128_000, inputTokens: 4_200, outputTokens: 970, finalResult: '审查暂未通过：需要补齐右侧 rail 与执行记录的折叠卡对齐。' },
    { agentId: 'ui-check', runId: 'mock-3', sessionId: 'agent-run', name: 'operator', role: 'operator', title: 'UI 验收', task: '验收三栏布局与流式渲染', state: 'ok', depth: 1, createdAt: Date.now() - 30_000, endedAt: Date.now() - 5_000, cost: 0.05, costUnit: 'CNY', exchangeRate: 7.2, turns: 3, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', contextTokens: 24_100, contextWindowTokens: 200_000, inputTokens: 8_300, outputTokens: 1_400, cacheTokens: 3_200, listSubtitle: '截图核对三栏对齐', finalResult: '布局验收通过：三栏对齐、消息流式渲染正常。' },
    { agentId: 'closeout', runId: 'mock-4', sessionId: 'agent-run', name: 'secretary', role: 'secretary', title: '收尾审计', task: '核对 worktree 与残留产物', state: 'ok', depth: 1, createdAt: Date.now() - 15_000, endedAt: Date.now() - 3_000, cost: 0.01, costUnit: 'CNY', exchangeRate: 7.2, turns: 1, provider: 'anthropic', model: 'anthropic/claude-sonnet-4', closeout: '已确认无残留', listSubtitle: '无未合并分支' }
  ]
  // Mock documents are project-scoped. The `pipiui` set reuses the shared
  // `mockDocumentContents` fixtures so the DocumentPanel fallback and the
  // mock host agree; other projects carry their own files so switching
  // projects visibly changes the document list.
  const mockDocumentsByProject: Record<string, DocumentContent[]> = {
    pipiui: mockDocumentContents,
    website: [
      { id: 'landing-page', name: 'landing-page.md', path: '/Users/demo/code/website/docs/landing-page.md', kind: 'markdown', size: 1420, updatedAt: Date.now() - 12 * 3_600_000, content: '# Landing page\n\n官网落地页的标题、副标题与 CTA 区块说明。' },
      { id: 'metrics-dashboard', name: 'metrics.md', path: '/Users/demo/code/website/docs/metrics.md', kind: 'markdown', size: 980, updatedAt: Date.now() - 3 * 86_400_000, content: '# 指标仪表盘\n\n流量、转化率与留存的关键指标定义。' }
    ],
    design: [
      { id: 'light-tokens', name: 'light-theme-tokens.md', path: '/Users/demo/code/design-system/docs/light-theme-tokens.md', kind: 'markdown', size: 760, updatedAt: Date.now() - 4 * 3_600_000, content: '# 浅色主题 Token\n\n--surface、--border、--text 等浅色主题变量说明。' },
      { id: 'dark-tokens', name: 'dark-theme-tokens.md', path: '/Users/demo/code/design-system/docs/dark-theme-tokens.md', kind: 'markdown', size: 820, updatedAt: Date.now() - 4 * 3_600_000, content: '# 深色主题 Token\n\n深色主题下的表面与文本色变量说明。' }
    ]
  }
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
  let sidebarSessionPreferences = { pinnedSessionIds: [] as string[], archivedSessionIds: [] as string[] }
  // Demo-only: restore the reload-persisted model when it is still in the catalog;
  // fall back to mockModels[0] otherwise (real host model state is owned by pi sessions).
  const savedDemoModel = readDemoModel()
  const restoredModel = savedDemoModel ? mockModels.find(model => model.provider === savedDemoModel.provider && model.id === savedDemoModel.id) : undefined
  const initialModel = restoredModel ?? mockModels[0]
  let modelState: ModelState = { model: initialModel, thinkingLevel: 'medium', availableThinkingLevels: initialModel.reasoning ? ['off', 'low', 'medium', 'high'] : ['off'] }
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
  let subagentModels: Record<string, SubagentModelSetting[]> = {}
  const agentDefinitions: AgentDefinition[] = [
    { name: 'explore', description: 'Grok-style research agent. Searches the web and the repository, reads, greps, and runs shell, but does not edit files.' },
    { name: 'plan', description: 'Grok-style planning agent. Explores and produces an implementation plan; does not edit files.' },
    { name: 'general-purpose', description: 'Grok-style full-capability worker. Implements tasks in an isolated context.' },
    { name: 'reviewer', description: 'Read-only code review specialist for quality and security.' },
    { name: 'computer-use-leader', description: 'Computer Use supervisor. Plans, recovers, and returns the final report.' },
    { name: 'operator', description: 'Computer-use desktop worker. Performs macOS desktop operations and returns a compressed text verdict; does not edit code files.' },
    { name: 'computer-verifier', description: 'Observe-only Computer Use verifier for fresh postcondition checks.' },
    { name: 'computer-terminal', description: 'Bounded terminal worker using an attenuated one-run Host tool broker; receives no desktop capability.' },
    { name: 'secretary', description: 'Boss closeout secretary. Reconciles agent outcomes, worktrees, branches, verification, temporary artifacts, and the existing Boss ledger without creating another worktree.' },
    { name: 'long-test', description: 'Long-running test runner. Executes end-to-end suites, integration/regression sweeps, opt-in long tests, and cross-repo E2E harnesses; reports pass/fail without fixing code.' }
  ]
  const emit = (sessionId: string, event: StreamEvent) => listeners.get(sessionId)?.forEach(listener => listener(event))
  const browser = createMockBrowserHost()
  let mockGit: GitStatus = { isRepo: true, currentBranch: 'pipiui/electron-git-branch', isDetached: false, shortSHA: '408cf26', localBranches: ['main', 'pipiui/electron-git-branch', 'pipiui/tunnel-reconnect'], upstream: 'origin/main', ahead: 2, behind: 0, isDirty: true, staged: 1, unstaged: 3, untracked: 2, githubURL: 'https://github.com/demo/pipiui' }
  return {
    protocolVersion: 2,
    listProjects: async () => projects,
    listSessions: async projectId => sessions.filter(session => session.projectId === projectId),
    newSession: async (projectId, name = '新会话') => { const session = { id: crypto.randomUUID(), projectId, name, updatedAt: Date.now() }; sessions.unshift(session); history[session.id] = []; return session },
    resumeSession: async sessionId => sessions.find(session => session.id === sessionId)!,
    deleteSession: async () => undefined,
    getSessionHistory: async sessionId => history[sessionId] ?? [],
    // Mock documents are project-scoped, mirroring the real backend's
    // `listDocuments(projectId)` — switching projects lists that project's files.
    listDocuments: async projectId => {
      const docs = (projectId && mockDocumentsByProject[projectId]) || mockDocumentsByProject['pipiui']
      return docs.map(({ content: _content, ...document }) => ({ ...document }))
    },
    readDocument: async documentId => {
      const all = Object.values(mockDocumentsByProject).flat()
      const document = all.find(item => item.id === documentId)
      if (!document) throw new Error(`unknown document: ${documentId}`)
      return { ...document }
    },
    getSessionLease: async sessionId => ({ sessionId, writable: true }),
    forceTakeoverSessionLease: async sessionId => ({ sessionId, writable: true }),
    sendPrompt: async (sessionId, prompt, attachments) => {
      const item = { id: crypto.randomUUID(), role: 'user' as const, content: prompt + (attachments?.length ? ` [${attachments.length} 张图片]` : ''), timestamp: Date.now() }
      ;(history[sessionId] ??= []).push(item)
      emit(sessionId, { type: 'status', sessionId, status: 'started' })
      emit(sessionId, { type: 'thinking', sessionId, contentIndex: 0, delta: '正在分析请求与当前项目结构…' })
      emit(sessionId, { type: 'tool_call', sessionId, toolCallId: 'read-package', name: 'read', delta: 'Electron/packages/ui/package.json' })
      window.setTimeout(() => emit(sessionId, { type: 'tool_result', sessionId, toolCallId: 'read-package', content: '已读取 package.json' }), 350)
      window.setTimeout(() => emit(sessionId, { type: 'text', sessionId, contentIndex: 0, delta: '已开始处理。流式 Markdown 会在完成后使用 Shiki 高亮代码块。' }), 500)
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
    retryQueuedMessage: async () => { throw new Error('mock queue is unavailable') },
    subscribeStream: (sessionId, listener) => { const bucket = listeners.get(sessionId) ?? new Set(); bucket.add(listener); listeners.set(sessionId, bucket); return () => bucket.delete(listener) },
    listModels: async () => mockModels,
    getModelState: async sessionId => {
      // Per-session binding, mirroring the real host: each session answers with
      // its own model (JSONL-backed there, fixture/localStorage here).
      if (sessionId) {
        const session = sessions.find(item => item.id === sessionId)
        const ref = session?.model
        if (ref) {
          const found = mockModels.find(model => model.provider === ref.provider && model.id === ref.modelId)
          if (found) return { model: found, thinkingLevel: 'medium', availableThinkingLevels: found.reasoning ? ['off', 'low', 'medium', 'high'] : ['off'] }
        }
      }
      return modelState
    },
    setModel: async (sessionId, provider, id) => {
      const found = mockModels.find(model => model.provider === provider && model.id === id)
      if (!found) throw new Error(`unknown model ${provider}/${id}`)
      modelState = { ...modelState, model: found, availableThinkingLevels: found.reasoning ? ['off', 'low', 'medium', 'high'] : ['off'] }
      // Session-scoped: keep the session's own model in sync so the sidebar row (and
      // future listSessions consumers) shows the same provider the chat uses.
      const target = sessions.find(session => session.id === sessionId)
      if (target) target.model = { provider: found.provider, modelId: found.id }
      writeDemoSessionModel(sessionId, found)
      writeDemoModel(found)
      return modelState
    },
    setThinkingLevel: async (_sessionId, level) => { modelState = { ...modelState, thinkingLevel: level }; return modelState },
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
    removeProviderCredentials: async providerId => {
      mockAuthCredentials.delete(providerId)
      mockModels = mockModels.filter(model => model.provider !== providerId)
      hiddenModelIds = hiddenModelIds.filter(id => !id.startsWith(`${providerId}/`))
      if (modelState.model.provider === providerId) {
        const next = mockModels[0] ?? { provider: 'unknown', id: 'unknown', name: '无可用模型', reasoning: false }
        modelState = { ...modelState, model: next, availableThinkingLevels: next.reasoning ? ['off', 'low', 'medium', 'high'] : ['off'] }
      }
      return modelState
    },
    openExternal: async () => undefined,
    getHiddenModelIds: async () => [...hiddenModelIds],
    setHiddenModelIds: async ids => { hiddenModelIds = [...new Set(ids)].sort(); return [...hiddenModelIds] },
    getSidebarSessionPreferences: async () => ({ pinnedSessionIds: [...sidebarSessionPreferences.pinnedSessionIds], archivedSessionIds: [...sidebarSessionPreferences.archivedSessionIds] }),
    setSidebarSessionPreferences: async preferences => {
      const archived = new Set(preferences.archivedSessionIds)
      sidebarSessionPreferences = { pinnedSessionIds: [...new Set(preferences.pinnedSessionIds)].filter(id => !archived.has(id)), archivedSessionIds: [...archived] }
      return { pinnedSessionIds: [...sidebarSessionPreferences.pinnedSessionIds], archivedSessionIds: [...sidebarSessionPreferences.archivedSessionIds] }
    },
    getComputerUseState: async () => ({ enabled: computerUseEnabled }),
    setComputerUseEnabled: async enabled => { computerUseEnabled = enabled; return { enabled: computerUseEnabled } },
    getSubagentModels: async () => Object.fromEntries(Object.entries(subagentModels).map(([name, chain]) => [name, chain.map(entry => ({ ...entry }))])),
    setSubagentModel: async (agentName, chain) => { if (chain.length) subagentModels[agentName] = chain.map(entry => ({ ...entry })); else delete subagentModels[agentName]; return Object.fromEntries(Object.entries(subagentModels).map(([name, saved]) => [name, saved.map(entry => ({ ...entry }))])) },
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
    getQuotaSnapshot: async () => modelState.model.provider.includes('openai')
      ? { provider: 'codex', accountLabel: 'Codex 账号额度', windows: [
          { id: 'primary', usedPercent: 4, label: '5h', title: '5小时额度' },
          { id: 'secondary', usedPercent: 12, label: '周', title: '周额度' }
        ] }
      : modelState.model.provider === 'deepseek'
        ? { provider: 'deepseek', accountLabel: '账户余额', balance: { amount: 88, currency: 'CNY' }, windows: [] }
        : null,
    subscribeSessionStats: () => () => undefined,
    listAgents: async sessionId => mockAgents.filter(agent => !sessionId || agent.sessionId === sessionId),
    // The demo agents have no run behind them, so there is no cached log to replay;
    // subscribeAgentLog below is what populates the panel.
    getAgentLogs: async () => [],
    subscribeAgents: () => () => undefined,
    subscribeAgentLog: (agentId, listener) => {
      if (agentId !== 'research') return () => undefined
      const timers: number[] = []
      // Stream cumulative log_delta snapshots (same contentIndex) so the demo shows one
      // progressively-updated row per entry — not a new line per chunk.
      const stream = (contentIndex: number, itemType: 'text' | 'thinking' | 'tool' | 'toolResult', name: string | undefined, chunks: string[]) => {
        let acc = ''
        chunks.forEach((chunk, i) => {
          timers.push(window.setTimeout(() => {
            acc += chunk
            listener({ type: 'agent_log', agentId, itemType, text: acc, name, contentIndex })
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
    capabilities: async () => ({ computerUse: false, revealInFinder: true, terminal: false, documents: true, browser: true, git: true, plan: false, retainedWorktreeDisposition: false }),
    gitStatus: async projectId => projectId === 'pipiui' ? { ...mockGit } : { isRepo: false, isDetached: false, localBranches: [], ahead: 0, behind: 0, isDirty: false, staged: 0, unstaged: 0, untracked: 0 },
    gitCheckout: async (_projectId, branch) => { mockGit = { ...mockGit, currentBranch: branch, isDetached: false }; return { ...mockGit } },
    revealProject: async () => undefined,
    browser
  }
}

/** Hidden-inset macOS chrome only applies inside the Electron shell; the plain-browser server mode keeps zero titlebar padding. */
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
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedSession, setSelectedSession] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [modelState, setModelState] = useState<ModelState | null>(null)
  const modelStatesBySessionRef = useRef(new Map<string, ModelState>())
  const [streaming, setStreaming] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [statsRefreshKey, setStatsRefreshKey] = useState(0)
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null)
  const [waitingVisible, setWaitingVisible] = useState(false)
  const [waitingPhase, setWaitingPhase] = useState<WaitingPhase>('awaiting')
  const [waitingDetail, setWaitingDetail] = useState<string | undefined>(undefined)
  const [lease, setLease] = useState<SessionLease | null>(null)
  const [activeTab, setActiveTab] = useState<PanelTab>('Subagents')
  const [announcedTerminals, setAnnouncedTerminals] = useState<Record<string, TerminalSession>>({})
  const [revealedTerminalIds, setRevealedTerminalIds] = useState<Record<string, string>>({})
  const [widths, setWidths] = useState<PaneWidths>(readWidths)
  const narrowViewport = useNarrowViewport()
  // Narrow-viewport override (not persisted): both panes start collapsed and the
  // header toggles / quick rail flip these to show the panes as overlays.
  const [narrowPanes, setNarrowPanes] = useState<{ sidebar: boolean; tools: boolean }>({ sidebar: false, tools: false })
  const [subagentsRunning, setSubagentsRunning] = useState(false)
  const [sidebarExpandedIds, setSidebarExpandedIds] = useState<string[]>([])
  const [pinnedSessionIds, setPinnedSessionIds] = useState<string[]>([])
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([])
  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_PROJECT_PAGE_SIZE)
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [sidebarAgents, setSidebarAgents] = useState<AgentSummary[]>([])
  const [observedSessionStatuses, setObservedSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [loadedSidebarPreferencesKey, setLoadedSidebarPreferencesKey] = useState('')
  const [canRevealInFinder, setCanRevealInFinder] = useState(false)
  const [gitAvailable, setGitAvailable] = useState(false)
  const [browserAvailable, setBrowserAvailable] = useState<boolean | undefined>(host.browser ? undefined : false)
  const [terminalAvailable, setTerminalAvailable] = useState<boolean | undefined>(host.terminal ? undefined : false)
  const [retainedWorktreeDispositionAvailable, setRetainedWorktreeDispositionAvailable] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [computerUseOpen, setComputerUseOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [subagentModelsOpen, setSubagentModelsOpen] = useState(false)
  const browserOccluded = modalOpen || computerUseOpen || remoteOpen || subagentModelsOpen
  const modalVisibility = useModelVisibility(host, modelState?.model)
  const transcriptRef = useRef<VirtuosoHandle>(null)
  const copiedTimerRef = useRef<number | null>(null)
  const sidebarStorageKey = useMemo(() => sidebarPreferencesKey(projects), [projects])
  // A host status can describe queued follow-ups. Only a local user send owns this waiting turn.
  const activeUserTurnRef = useRef(false)
  const historyLoadRef = useRef(0)
  const sessionQueue = useSessionQueue(host, selectedSession, streaming)
  const canWriteLease = leaseCanWrite(lease)
  const leaseReadOnly = lease !== null && !canWriteLease
  /** The explicit path read performs the one-time backend migration; listProjects supplies matching UI metadata. */
  const refreshProjects = useCallback(async () => {
    const paths = host.getProjectPaths ? await host.getProjectPaths() : undefined
    const listed = await host.listProjects()
    const explicitPaths = paths ? new Set(paths) : undefined
    const items = explicitPaths ? listed.filter(project => explicitPaths.has(project.path)) : listed
    const groupedSessions = await Promise.all(items.map(project => host.listSessions(project.id).catch(() => [])))
    const nextSessions = groupedSessions.flat()
    const validProjectIds = new Set(items.map(project => project.id))
    const validSessionIds = new Set(nextSessions.map(session => session.id))
    setProjects(items)
    setSessions(nextSessions)
    setSelectedProject(current => validProjectIds.has(current) ? current : items[0]?.id ?? '')
    setSelectedSession(current => validSessionIds.has(current) ? current : nextSessions[0]?.id ?? '')
    return items
  }, [host])

  useEffect(() => { void refreshProjects().catch(error => setProjectError(`加载项目失败：${error instanceof Error ? error.message : String(error)}`)); void host.capabilities().then(capabilities => { setCanRevealInFinder(capabilities.revealInFinder && typeof host.revealProject === 'function'); setBrowserAvailable(Boolean(capabilities.browser && host.browser)); setTerminalAvailable(Boolean(capabilities.terminal && host.terminal)); setGitAvailable(Boolean(capabilities.git && host.gitStatus)); setRetainedWorktreeDispositionAvailable(Boolean(capabilities.retainedWorktreeDisposition)) }).catch(() => { setCanRevealInFinder(false); setBrowserAvailable(false); setTerminalAvailable(false); setGitAvailable(false); setRetainedWorktreeDispositionAvailable(false) }) }, [host, refreshProjects])
  useEffect(() => {
    if (!host.browser || !selectedSession) return
    void host.browser.selectSession(selectedSession)
  }, [host, selectedSession])
  useEffect(() => {
    if (!host.browser) return
    return host.browser.subscribe(event => {
      if (event.type === 'reveal' && event.sessionId === selectedSession) setActiveTab('Browser')
    })
  }, [host, selectedSession])
  useEffect(() => {
    if (!host.terminal?.subscribeAll) return
    return host.terminal.subscribeAll((event: TerminalEvent) => {
      if (event.type === 'opened') setAnnouncedTerminals(current => ({ ...current, [event.sessionId]: event.terminal }))
      if (event.type === 'reveal' && event.sessionId === selectedSession) { setRevealedTerminalIds(current => ({ ...current, [event.sessionId]: event.terminalId })); setActiveTab('Terminal') }
    })
  }, [host, selectedSession])
  useEffect(() => {
    let mounted = true
    void host.listAgents().then(snapshot => { if (mounted) setSidebarAgents(snapshot) }).catch(() => { if (mounted) setSidebarAgents([]) })
    const unsubscribe = host.subscribeAgents(event => {
      if (event.type !== 'agent') return
      setSidebarAgents(current => {
        const index = current.findIndex(agent => agent.agentId === event.agent.agentId)
        return index < 0 ? [...current, event.agent] : current.map(agent => agent.agentId === event.agent.agentId ? event.agent : agent)
      })
    })
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
      if (host.getSidebarSessionPreferences && host.setSidebarSessionPreferences) {
        const remote = await host.getSidebarSessionPreferences()
        const migrated = localStorage.getItem(sidebarSemanticMigrationKey) === '1'
        if (migrated) {
          pinned = remote.pinnedSessionIds
          archived = remote.archivedSessionIds
        } else {
          archived = [...new Set([...remote.archivedSessionIds, ...archived])]
          const archivedSet = new Set(archived)
          pinned = [...new Set([...remote.pinnedSessionIds, ...pinned])].filter(id => !archivedSet.has(id))
          await host.setSidebarSessionPreferences({ pinnedSessionIds: pinned, archivedSessionIds: archived })
          localStorage.setItem(sidebarSemanticMigrationKey, '1')
        }
      }
      if (!active) return
      setPinnedSessionIds(pinned)
      setArchivedSessionIds(archived)
      setLoadedSidebarPreferencesKey(sidebarStorageKey)
    })().catch(error => {
      if (!active) return
      setProjectError(`加载侧栏偏好失败：${error instanceof Error ? error.message : String(error)}`)
      setPinnedSessionIds(saved?.pinnedSessionIds ?? [])
      setArchivedSessionIds(saved?.archivedSessionIds ?? [])
      setLoadedSidebarPreferencesKey(sidebarStorageKey)
    })
    return () => { active = false }
  }, [host, loadedSidebarPreferencesKey, projects, sidebarStorageKey])
  useEffect(() => {
    if (!projects.length || loadedSidebarPreferencesKey !== sidebarStorageKey) return
    writeSidebarPreferences(sidebarStorageKey, { expandedIds: sidebarExpandedIds, pinnedSessionIds, archivedSessionIds, visibleLimit: sidebarVisibleLimit })
    if (host.setSidebarSessionPreferences) {
      void host.setSidebarSessionPreferences({ pinnedSessionIds, archivedSessionIds }).catch(error => setProjectError(`保存侧栏偏好失败：${error instanceof Error ? error.message : String(error)}`))
    }
  }, [host, loadedSidebarPreferencesKey, pinnedSessionIds, archivedSessionIds, projects.length, sidebarExpandedIds, sidebarStorageKey, sidebarVisibleLimit])
  useEffect(() => { if (!selectedProject) return; void host.listSessions(selectedProject).then(items => { setSessions(current => [...current.filter(session => session.projectId !== selectedProject), ...items]); setSelectedSession(previous => items.some(item => item.id === previous) ? previous : items[0]?.id ?? '') }) }, [host, selectedProject])
  useEffect(() => { document.title = sessions.find(session => session.id === selectedSession)?.name ?? 'PipiUI' }, [selectedSession, sessions])
  useEffect(() => {
    let current = true
    const sessionId = selectedSession
    const immediate = modelStatesBySessionRef.current.get(sessionId)
      ?? modelStateFromSession(sessions.find(session => session.id === sessionId), modalVisibility.models)
    if (immediate) setModelState(immediate)
    void host.getModelState(selectedSession || undefined)
      .then(state => {
        if (!current) return
        if (sessionId) modelStatesBySessionRef.current.set(sessionId, state)
        setModelState(state)
      })
      // Failure fallback: the session's own model (from listSessions) keeps the
      // chip/row per-session even when the host model query itself failed.
      .catch(() => {
        if (!current || !selectedSession) return
        const ref = sessions.find(session => session.id === selectedSession)?.model
        if (ref) setModelState({ model: { provider: ref.provider, id: ref.modelId, name: ref.modelId, reasoning: false }, thinkingLevel: 'off', availableThinkingLevels: ['off'] })
      })
    return () => { current = false }
  }, [host, modalVisibility.models, selectedSession, sessions])
  useEffect(() => {
    const request = ++historyLoadRef.current
    if (!selectedSession) {
      setMessages([])
      setLease(null)
      return
    }
    activeUserTurnRef.current = false
    setStreaming(false)
    setCompacting(false)
    setWaitingVisible(false)
    setWaitingStartedAt(null)
    setMessages([])
    setLease(null)
    void host.getSessionHistory(selectedSession).then(entries => {
      if (historyLoadRef.current !== request) return
      const messages = historyMessages(entries)
      setMessages(messages)
      requestAnimationFrame(() => transcriptRef.current?.scrollToIndex({ index: Math.max(0, messages.length - 1), align: 'end', behavior: 'auto' }))
    }).catch(() => { if (historyLoadRef.current === request) setMessages([]) })
    void host.getSessionLease(selectedSession).then(lease => { if (historyLoadRef.current === request) setLease(lease) }).catch(() => { if (historyLoadRef.current === request) setLease(null) })
  }, [host, selectedSession])
  useEffect(() => {
    if (!selectedSession) return
    const coalescer = new StreamEventCoalescer({ onEvent: event => {
      if (event.type === 'queue_update') {
        sessionQueue.acceptStreamEvent(event)
        return
      }
      if (event.type === 'compaction') {
        setCompacting(event.phase === 'start')
        setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'tool', content: compactionNotice(event) }])
        // Post-compaction pi reports null tokens until the next assistant usage;
        // pull one authoritative snapshot so the pill drops the stale number.
        if (event.phase === 'end') setStatsRefreshKey(key => key + 1)
        return
      }
      if (event.type === 'status') {
        const terminal = event.status === 'settled' || event.status === 'stopped'
        const sidebarStatus: SessionStatus = event.status === 'started' || event.status === 'streaming'
          ? 'running'
          : event.status === 'settled' ? 'completed' : 'interrupted'
        setObservedSessionStatuses(current => current[event.sessionId] === sidebarStatus ? current : { ...current, [event.sessionId]: sidebarStatus })
        if (event.status === 'started' || event.status === 'streaming') setStreaming(true)
        if (terminal) {
          setStreaming(false)
          setStatsRefreshKey(key => key + 1)
          // Settle the streaming assistant message no matter who started the turn
          // (direct send, resumed/read-only session, queue dispatch, background
          // turn): otherwise the "N 个步骤" card stays expanded forever.
          setMessages(previous => finishStreamingMessage(previous))
        }
        if (terminal && activeUserTurnRef.current) {
          activeUserTurnRef.current = false
          setWaitingVisible(false)
          setWaitingStartedAt(null)
          setWaitingDetail(undefined)
        }
        return
      }
      // Thinking and tool runs live inside folded cards — keep the placeholder
      // visible with an appropriate phase so the user never sees a silent gap
      // between sending their message and the first readable text. Only real
      // text output ends the first-token wait.
      if (activeUserTurnRef.current) {
        if (event.type === 'text') {
          setWaitingVisible(false)
        } else if (event.type === 'thinking') {
          setWaitingPhase('thinking')
        } else if (event.type === 'tool_call' || event.type === 'tool_result') {
          setWaitingPhase('tool')
          if (event.type === 'tool_call' && event.name === 'subagent') setWaitingDetail('子任务执行中')
          else if (event.type === 'tool_call') setWaitingDetail(undefined)
        }
      }
      setMessages(previous => applyStreamEvent(previous, event))
    } })
    const unsubscribe = host.subscribeStream(selectedSession, event => coalescer.push(event))
    return () => { unsubscribe(); coalescer.dispose() }
  }, [host, selectedSession, sessionQueue.acceptStreamEvent])
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
  useEffect(() => () => { if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current) }, [])

  const send = async (draft: string, attachments?: PromptAttachment[]) => {
    const prompt = draft.trim()
    if (!prompt && !attachments?.length) return false
    if (!selectedSession || !canWriteLease) return false
    const targetSession = selectedSession
    const beginDirectTurn = () => {
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'user', content: prompt + (attachments?.length ? ` [${attachments.length} 张图片]` : ''), timestamp: Date.now() }])
      activeUserTurnRef.current = true
      setStreaming(true)
      setWaitingStartedAt(Date.now())
      setWaitingVisible(true)
      setWaitingPhase('awaiting')
      setWaitingDetail(undefined)
    }
    const resetFailedDirectTurn = () => {
      activeUserTurnRef.current = false
      setStreaming(false)
      setWaitingVisible(false)
      setWaitingStartedAt(null)
      setWaitingDetail(undefined)
    }

    if (sessionQueue.busy) {
      const result = await sessionQueue.enqueue(prompt, attachments)
      // The host owns queue state. A queued outcome arrives through
      // queue_update; a just-idle race can legitimately dispatch directly.
      if (result.outcome === 'queued' || selectedSession !== targetSession) return true
      beginDirectTurn()
      return true
    }

    beginDirectTurn()
    try {
      if (attachments?.length) await host.sendPrompt(targetSession, prompt, attachments)
      else await host.sendPrompt(targetSession, prompt)
      return true
    } catch (error) {
      resetFailedDirectTurn()
      throw error
    }
  }
  /**
   * `/compact`. Progress and the outcome normally arrive as `compaction` stream
   * events; a refusal ("Nothing to compact") never produces one, so the
   * rejection is what the transcript reports.
   */
  const compact = async () => {
    if (!selectedSession || !canWriteLease || !host.compact) return
    try {
      await host.compact(selectedSession)
    } catch (error) {
      setCompacting(false)
      setMessages(items => [...items, { id: crypto.randomUUID(), role: 'tool', content: `上下文压缩失败：${error instanceof Error ? error.message : String(error)}` }])
    }
  }
  const handleCopy = async (message: ChatMessage) => {
    if (!message.content.trim()) return
    await navigator.clipboard.writeText(message.content)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    setCopiedId(message.id)
    copiedTimerRef.current = window.setTimeout(() => {
      setCopiedId(current => current === message.id ? null : current)
      copiedTimerRef.current = null
    }, 1200)
  }
  const handleResend = (message: ChatMessage) => {
    // Electron has no fork/resend RPC yet: this deliberately sends a new prompt.
    void send(message.content).catch(() => undefined)
  }
  const resendDisabled = Boolean(!canWriteLease || streaming || sessionQueue.busy)

  const newSession = async (projectId = selectedProject) => {
    if (!projectId) return
    const session = await host.newSession(projectId)
    setSessions(items => [session, ...items])
    setSelectedProject(projectId)
    setSelectedSession(session.id)
    setSidebarExpandedIds(current => current.includes(projectId) ? current : [...current, projectId])
    setMessages([])
  }
  const addProject = async (path: string): Promise<boolean> => {
    if (!host.addProject) {
      setProjectError('当前连接不支持添加项目')
      return false
    }
    const normalizedPath = path.trim()
    if (!normalizedPath) return false
    const snapshot = { projects, sessions, selectedProject, selectedSession }
    const name = normalizedPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || normalizedPath
    const optimistic: Project = { id: `pending-project:${normalizedPath}`, name, path: normalizedPath }
    setProjects(current => current.some(project => project.path === normalizedPath) ? current : [...current, optimistic])
    setSidebarExpandedIds(current => current.includes(optimistic.id) ? current : [...current, optimistic.id])
    setProjectError(null)
    try {
      await host.addProject(normalizedPath)
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
      await refreshProjects()
      return true
    } catch (error) {
      setProjectError(`添加项目后刷新失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
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
      const model = sidebarModelForSession(session, selectedSession, modelState?.model ?? null)
      const status = sidebarStatusForSession(session.id, selectedSession, streaming, observedSessionStatuses[session.id], sidebarAgents)
      mapped.set(session.id, { id: session.id, projectId: session.projectId, title: session.name, provider: model.provider, modelId: model.modelId, status: status.status, subagentCount: status.subagentCount, updatedAt: session.updatedAt })
    }
    return mapped
  }, [modelState, observedSessionStatuses, selectedSession, sessions, sidebarAgents, streaming])
  const pinnedSessionIdSet = useMemo(() => new Set(pinnedSessionIds), [pinnedSessionIds])
  const archivedSessionIdSet = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const pinnedSidebarSessions = useMemo(() => pinnedSessionIds.flatMap(id => {
    const session = sidebarSessionById.get(id)
    return session ? [session] : []
  }), [pinnedSessionIds, sidebarSessionById])
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
    sessions: sessions.filter(session => session.projectId === project.id && !pinnedSessionIdSet.has(session.id) && !archivedSessionIdSet.has(session.id)).flatMap(session => {
      const mapped = sidebarSessionById.get(session.id)
      return mapped ? [mapped] : []
    })
  })), [archivedSessionIdSet, pinnedSessionIdSet, projects, sessions, sidebarSessionById])
  const sidebarProjectMenuUnavailable = useMemo<ProjectMenuUnavailable>(() => ({
    rename: '待宿主支持',
    ...(!host.removeProject ? { remove: '当前连接不支持移除项目' } : {}),
    ...(!canRevealInFinder ? { reveal: '当前连接不支持在 Finder 中显示' } : {})
  }), [canRevealInFinder, host.removeProject])
  const toggleSidebarProject = (projectId: string) => {
    setSelectedProject(projectId)
    setSidebarExpandedIds(current => current.includes(projectId) ? current.filter(id => id !== projectId) : [...current, projectId])
  }
  const selectSidebarSession = (sessionId: string) => {
    const session = sessions.find(item => item.id === sessionId)
    if (session) {
      setSelectedProject(session.projectId)
      setSidebarExpandedIds(current => current.includes(session.projectId) ? current : [...current, session.projectId])
    }
    const immediate = modelStatesBySessionRef.current.get(sessionId)
      ?? modelStateFromSession(session, modalVisibility.models)
    if (immediate) setModelState(immediate)
    setSelectedSession(sessionId)
  }

  const applySelectedModelState = (state: ModelState) => {
    if (selectedSession) modelStatesBySessionRef.current.set(selectedSession, state)
    setModelState(state)
  }
  const onSidebarProjectMenu = (projectId: string, action: ProjectMenuAction) => {
    if (action === 'newSession') { void newSession(projectId); return }
    if (action === 'reveal' && canRevealInFinder) void host.revealProject?.(projectId)
    if (action === 'remove') void removeProject(projectId)
    // Rename remains disabled until the host exposes an explicit rename contract.
  }
  const pinSidebarSession = (sessionId: string) => setPinnedSessionIds(current => current.includes(sessionId) ? current.filter(id => id !== sessionId) : [...current, sessionId])
  const renameSidebarSession = (sessionId: string) => { /* Host rename contract pending; select the session for now. */ selectSidebarSession(sessionId) }
  const archiveSidebarSession = (sessionId: string) => {
    setArchivedSessionIds(current => current.includes(sessionId) ? current : [...current, sessionId])
    setPinnedSessionIds(current => current.filter(id => id !== sessionId))
  }
  const unarchiveSidebarSession = (sessionId: string) => setArchivedSessionIds(current => current.filter(id => id !== sessionId))
  const resize = (pane: keyof PaneWidths, start: number) => (event: React.PointerEvent) => { const origin = event.clientX; const onMove = (move: PointerEvent) => setWidths(current => ({ ...current, [pane]: clamp(start + (pane === 'sidebar' ? move.clientX - origin : origin - move.clientX), pane === 'sidebar' ? 190 : 270, pane === 'sidebar' ? 440 : 620) })); const done = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', done) }; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', done) }
  const toggleSidebar = () => {
    if (narrowViewport) setNarrowPanes(current => ({ ...current, sidebar: !current.sidebar }))
    else setWidths(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }))
  }
  const toggleTools = () => {
    if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: !current.tools }))
    else setWidths(current => ({ ...current, toolsCollapsed: !current.toolsCollapsed }))
  }
  /** Swift panelQuickRail behavior: switching opens the panel, re-clicking the active tool closes it. */
  const selectTool = (tab: PanelTab) => {
    if (!toolsCollapsed && activeTab === tab) {
      if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: false }))
      else setWidths(current => ({ ...current, toolsCollapsed: true }))
      return
    }
    setActiveTab(tab)
    if (toolsCollapsed) {
      if (narrowViewport) setNarrowPanes(current => ({ ...current, tools: true }))
      else setWidths(current => ({ ...current, toolsCollapsed: false }))
    }
  }

  const shellClass = `pipiui-shell${isElectronChrome() ? ' titlebar-pad' : ''}${sidebarCollapsed ? ' sidebar-collapsed' : ''}${toolsCollapsed ? ' tools-collapsed' : ''}`
  return <main className={shellClass} data-theme={theme} style={{ '--sidebar-w': `${widths.sidebar}px`, '--tools-w': `${widths.tools}px` } as React.CSSProperties}>
    {/* hiddenInset titlebar band: draggable chrome strip (title lives in the chat header only), keeps traffic lights clear of content. */}
    <div className="titlebar-drag" />
    <Sidebar projects={sidebarProjects} pinnedSessions={pinnedSidebarSessions} archivedSessions={archivedSidebarSessions} expandedIds={sidebarExpandedIds} selectedSessionId={selectedSession || null} searchQuery={sidebarSearch} visibleLimit={sidebarVisibleLimit} onToggleProject={toggleSidebarProject} onSelectSession={selectSidebarSession} onNewSession={projectId => void newSession(projectId)} onProjectMenu={onSidebarProjectMenu} projectMenuUnavailable={sidebarProjectMenuUnavailable} onAddProject={addProject} projectAddUnavailable={host.addProject ? undefined : '当前连接不支持添加项目'} projectError={projectError} onDismissProjectError={() => setProjectError(null)} onSearch={setSidebarSearch} onShowMore={() => setSidebarVisibleLimit(limit => limit + SIDEBAR_PROJECT_PAGE_SIZE)} onPinSession={pinSidebarSession} onRenameSession={renameSidebarSession} onArchiveSession={archiveSidebarSession} onUnarchiveSession={unarchiveSidebarSession} onOpenSettings={() => setModalOpen(true)} onOpenComputerUse={() => setComputerUseOpen(true)} onOpenRemote={() => setRemoteOpen(true)} onOpenSubagentModels={() => setSubagentModelsOpen(true)} />
    <ResizeHandle label="调整左栏宽度" onPointerDown={resize('sidebar', widths.sidebar)} />
    <section className="chat-column">
      <ChatHeader session={sessions.find(item => item.id === selectedSession)} project={projects.find(item => item.id === selectedProject)} lease={lease} host={host} gitAvailable={gitAvailable} sidebarCollapsed={sidebarCollapsed} toolsCollapsed={toolsCollapsed} onToggleSidebar={toggleSidebar} onToggleTools={toggleTools} onTakeover={async () => { if (selectedSession) setLease(await host.forceTakeoverSessionLease(selectedSession)) }} />
      <div className="chat-viewport" data-testid="chat-viewport">
        <ToolQuickRail activeTab={activeTab} toolsCollapsed={toolsCollapsed} onSelect={selectTool} host={host} browserAvailable={browserAvailable} terminalAvailable={terminalAvailable} subagentsRunning={subagentsRunning} />
        <Transcript messages={messages} transcriptRef={transcriptRef} onCopy={handleCopy} onResend={handleResend} resendDisabled={resendDisabled} copiedId={copiedId} waiting={waitingVisible && waitingStartedAt !== null ? { startedAt: waitingStartedAt, phase: waitingPhase, detail: waitingDetail, onStop: () => { setWaitingPhase('stopping'); if (selectedSession) void host.stop(selectedSession) } } : undefined} />
      </div>
      <div className="chat-composer-stack" data-testid="chat-composer-stack">
        {sessionQueue.error && <div className="queue-operation-error" role="alert" data-testid="queue-operation-error"><span>{sessionQueue.error}</span><button aria-label="关闭队列错误" onClick={sessionQueue.dismissError}>×</button></div>}
        <MessageQueue items={sessionQueue.items} expanded={sessionQueue.expanded} pending={sessionQueue.pending} mutationsDisabled={leaseReadOnly} canSteer={sessionQueue.busy} onToggle={() => sessionQueue.setExpanded(!sessionQueue.expanded)} onPromote={id => { if (!leaseReadOnly) void sessionQueue.promote(id).catch(() => undefined) }} onEdit={(id, text) => { if (!leaseReadOnly) void sessionQueue.edit(id, text).catch(() => undefined) }} onRemove={id => { if (!leaseReadOnly) void sessionQueue.remove(id).catch(() => undefined) }} onRetry={id => { if (!leaseReadOnly) void sessionQueue.retry(id).catch(() => undefined) }} onSteer={id => { if (!leaseReadOnly) void sessionQueue.steer(id).catch(() => undefined) }} />
        <Composer key={selectedSession} streaming={streaming} compacting={compacting} queueBusy={sessionQueue.busy} readOnly={leaseReadOnly} leaseOwner={leaseReadOnly ? leaseOwnerLabel(lease) : undefined} onTakeover={async () => { if (selectedSession) setLease(await host.forceTakeoverSessionLease(selectedSession)) }} modelState={modelState} host={host} sessionId={selectedSession} statsRefreshKey={statsRefreshKey} visibility={modalVisibility} onOpenModelManager={() => setModalOpen(true)} onCompact={compact} onSend={send} onStop={() => { setWaitingPhase('stopping'); if (selectedSession) void host.stop(selectedSession) }} onModel={applySelectedModelState} />
      </div>
    </section>
    <ResizeHandle label="调整工具栏宽度" onPointerDown={resize('tools', widths.tools)} />
    <ToolPanel activeTab={activeTab} host={host} theme={theme} sessionId={selectedSession} announcedTerminal={selectedSession ? announcedTerminals[selectedSession] : undefined} revealedTerminalId={selectedSession ? revealedTerminalIds[selectedSession] : undefined} onSubagentsRunningChange={setSubagentsRunning} browserAvailable={browserAvailable} browserOccluded={browserOccluded} terminalAvailable={terminalAvailable} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} projectId={selectedProject} projectPath={projects.find(project => project.id === selectedProject)?.path} />
    {modalOpen && <ModelVisibilityModal host={host} visibility={modalVisibility} current={modelState?.model ?? null} onModelState={applySelectedModelState} onClose={() => setModalOpen(false)} />}
    {computerUseOpen && <ComputerUsePanel host={host} onClose={() => setComputerUseOpen(false)} />}
    {remoteOpen && <RemoteConnectionPanel onClose={() => setRemoteOpen(false)} />}
    {subagentModelsOpen && <SubagentModelModal host={host} current={modelState?.model ?? null} visibility={modalVisibility} onClose={() => setSubagentModelsOpen(false)} />}
  </main>
}

/**
 * Build transcript messages from history entries, preserving the folded
 * tool/turn structure: assistant entries with thinking/tools render as the
 * same collapsed "N 个步骤" cards as the live stream (Swift parity), and
 * toolResult entries attach to their tool card instead of a bare row.
 */
export function historyMessages(entries: HistoryEntry[]): ChatMessage[] {
  const cards = new Map<string, ToolCard>()
  const messages: ChatMessage[] = []
  for (const entry of entries) {
    if (entry.role === 'assistant' && (entry.thinking || entry.tools?.length)) {
      const tools = entry.tools?.map(tool => ({ id: tool.id, name: tool.name, input: tool.input, startedAt: entry.timestamp, finished: true }))
      for (const tool of tools ?? []) cards.set(tool.id, tool)
      // pi emits one assistant message per tool round, so a burst of consecutive
      // tool-only turns (no text/thinking) coalesces into one folded card (Swift
      // finishedGroup parity) instead of a stack of "1 个步骤" cards. Tool results
      // still attach by id: the shared ToolCard objects are already in `cards`.
      const toolOnly = (entry.tools?.length ?? 0) > 0 && !entry.content && !entry.thinking
      const previous = messages[messages.length - 1]
      if (toolOnly && previous?.role === 'assistant' && (previous.tools?.length ?? 0) > 0 && !previous.content && !previous.thinking) {
        previous.tools!.push(...tools!)
        continue
      }
      messages.push({ id: entry.id, role: 'assistant', content: entry.content, thinking: entry.thinking, tools, timestamp: entry.timestamp })
      continue
    }
    if (entry.role === 'tool' && entry.toolCallId && cards.has(entry.toolCallId)) {
      const tool = cards.get(entry.toolCallId)!
      tool.result = entry.content
      tool.error = entry.isError
      if (entry.images) tool.images = entry.images
      continue
    }
    messages.push({ id: entry.id, role: entry.role, content: entry.content })
  }
  return messages
}

export function applyStreamEvent(previous: ChatMessage[], event: Exclude<StreamEvent, { type: 'status' }>): ChatMessage[] {
  const index = previous.findLastIndex(item => item.role === 'assistant')
  const current = index >= 0 && previous[index].streaming ? previous[index] : { id: `stream-${Date.now()}`, role: 'assistant' as const, content: '', thinking: '', tools: [], streaming: true, timestamp: Date.now() }
  const next = index >= 0 && previous[index].streaming ? [...previous] : [...previous, current]
  const updated: ChatMessage = { ...current, tools: [...(current.tools ?? [])] }
  if (event.type === 'text') updated.content += event.delta
  if (event.type === 'thinking') updated.thinking = (updated.thinking ?? '') + event.delta
  if (event.type === 'tool_call') {
    const toolIndex = updated.tools!.findIndex(item => item.id === event.toolCallId)
    if (toolIndex >= 0) updated.tools![toolIndex] = { ...updated.tools![toolIndex], input: updated.tools![toolIndex].input + (event.delta ?? '') }
    else updated.tools!.push({ id: event.toolCallId, name: event.name, input: event.delta ?? '', startedAt: Date.now() })
  }
  if (event.type === 'tool_result') {
    const toolIndex = updated.tools!.findIndex(item => item.id === event.toolCallId)
    if (toolIndex >= 0) updated.tools![toolIndex] = { ...updated.tools![toolIndex], result: event.content, error: event.isError, finished: true, images: event.images }
  }
  next[next.length - 1] = updated
  return next
}

export function finishStreamingMessage(messages: ChatMessage[]): ChatMessage[] {
  const index = messages.findLastIndex(message => message.role === 'assistant' && message.streaming)
  if (index < 0) return messages
  const next = [...messages]
  next[index] = { ...next[index], streaming: false }
  return next
}

function ResizeHandle({ label, onPointerDown }: { label: string; onPointerDown: (event: React.PointerEvent) => void }) { return <div className="resize-handle" role="separator" aria-label={label} onPointerDown={onPointerDown} /> }
function ChatHeader({ session, project, lease, host, gitAvailable, sidebarCollapsed, toolsCollapsed, onToggleSidebar, onToggleTools, onTakeover }: { session?: Session; project?: Project; lease: SessionLease | null; host: PipiHostAPI; gitAvailable: boolean; sidebarCollapsed: boolean; toolsCollapsed: boolean; onToggleSidebar: () => void; onToggleTools: () => void; onTakeover: () => void }) { const readOnly = lease !== null && !leaseCanWrite(lease); return <header className="chat-header"><button data-testid="toggle-sidebar" title={sidebarCollapsed ? '展开左栏' : '收起左栏'} aria-label={sidebarCollapsed ? '展开左栏' : '收起左栏'} aria-expanded={!sidebarCollapsed} onClick={onToggleSidebar}>≡</button><div className="chat-header-title"><strong>{session?.name ?? '新会话'}</strong>{readOnly && <span className="lease-detail">由 {leaseOwnerLabel(lease)} 运行中 · 只读 <button data-testid="lease-takeover-header" onClick={onTakeover}>强制接管</button></span>}</div><div className="chat-header-actions"><GitBranchMenu host={host} projectId={project?.id} available={gitAvailable} /><button data-testid="toggle-tools" title={toolsCollapsed ? '展开右栏' : '收起右栏'} aria-label={toolsCollapsed ? '展开右栏' : '收起右栏'} aria-expanded={!toolsCollapsed} onClick={onToggleTools}>▤</button></div></header> }
type MessageActionHandlers = { onCopy: (message: ChatMessage) => Promise<void>; onResend: (message: ChatMessage) => void; resendDisabled: boolean; copiedId: string | null }
function Transcript({ messages, transcriptRef, waiting, onCopy, onResend, resendDisabled, copiedId }: { messages: ChatMessage[]; transcriptRef: React.RefObject<VirtuosoHandle>; waiting?: { startedAt: number; phase: WaitingPhase; detail?: string; onStop: () => void } } & MessageActionHandlers) { const [atBottom, setAtBottom] = useState(true); const [seekingId, setSeekingId] = useState<string | null>(null); const prompts = useMemo(() => buildRailPrompts(messages), [messages]); const { activeId: viewportActiveId, containerRef } = useActivePromptId(prompts, atBottom); const activeId = seekingId ?? viewportActiveId; useEffect(() => { if (atBottom) setSeekingId(null) }, [atBottom]); const jump = (index: number, id: string) => { setSeekingId(id); transcriptRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' }) }; const returnLatest = () => { setSeekingId(null); transcriptRef.current?.scrollToIndex({ index: Math.max(0, messages.length - 1), align: 'end', behavior: 'smooth' }); setAtBottom(true) }; return <div className="transcript-area" ref={containerRef}><PromptRail prompts={prompts} activeId={activeId} onJump={jump} /><MessageList ref={transcriptRef} messages={messages} atBottom={atBottom} onAtBottom={setAtBottom} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copiedId={copiedId} />{waiting && <WaitingPlaceholder phase={waiting.phase} startedAt={waiting.startedAt} detail={waiting.detail} onStop={waiting.onStop} />}{!atBottom && messages.length > 0 && <button className="return-latest" onClick={returnLatest}>回到最新</button>}</div> }
const MessageList = memo(forwardRef<VirtuosoHandle, { messages: ChatMessage[]; atBottom: boolean; onAtBottom: (value: boolean) => void } & MessageActionHandlers>(function MessageList({ messages, atBottom, onAtBottom, onCopy, onResend, resendDisabled, copiedId }, ref) { return <div className="message-list" data-testid="message-scroll"><Virtuoso ref={ref} data={messages} followOutput={() => atBottom ? 'auto' : false} atBottomStateChange={onAtBottom} alignToBottom itemContent={(index, message) => { const next = messages[index + 1]; const isTurnEnd = message.role === 'user' || (!message.streaming && (!next || next.role !== 'assistant')); return <MessageView message={message} showFooter={isTurnEnd} onCopy={onCopy} onResend={onResend} resendDisabled={resendDisabled} copied={copiedId === message.id} /> } } /></div> }))
function messageTime(timestamp?: number): string { if (!timestamp) return ''; return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
export const MessageView = memo(function MessageView({ message, showFooter, onCopy, onResend, resendDisabled, copied }: { message: ChatMessage; showFooter?: boolean; copied?: boolean } & Omit<MessageActionHandlers, 'copiedId'>) { const copyDisabled = !message.content.trim(); const copy = () => { void onCopy(message).catch(() => undefined) }; const time = showFooter && message.timestamp ? <time className="message-time">{messageTime(message.timestamp)}</time> : null; const actions = showFooter ? <MessageActionBar alignment={message.role === 'user' ? 'trailing' : 'leading'} canCopy canResend={message.role === 'user' && Boolean(message.content.trim())} copyDisabled={copyDisabled} resendDisabled={resendDisabled} onCopy={copy} onResend={() => onResend(message)} copied={copied} /> : null;if (message.role === 'user') return <article className="message user-message" data-user-prompt={message.id}><div className="user-message-stack"><UserMessageBubble text={message.content} />{actions}</div>{time}</article>; if (message.role === 'tool') { const notice = parseSubagentNotice(message.content); return notice ? <article className="message assistant-message"><CollapsibleActivityCard kind="result" label="子任务" summary={notice.name} meta={`${notice.ok ? '成功' : '失败'} · ${notice.cost}`}><pre>{message.content}</pre></CollapsibleActivityCard>{actions}{time}</article> : <article className="system-message tool-message"><div>{message.content}</div>{actions}{time}</article> } return <article className="message assistant-message"><AssistantTranscriptContent message={message} />{actions || time ? <div className="assistant-message-footer">{actions}{time}</div> : null}</article> })
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
  /** Object URL for preview; revoked on remove/unmount/successful send. */
  url: string
  /** Pasted/clipboard attachment; base64 is read at send time only. */
  file: File
}

function toPromptAttachment(a: ComposerAttachment): Promise<PromptAttachment> {
  return fileToPromptAttachment(a.file).catch(() => { throw new Error('无法读取图片') })
}

function Composer({ streaming, compacting, queueBusy, readOnly, leaseOwner, onTakeover, modelState, host, sessionId, statsRefreshKey, visibility, onOpenModelManager, onCompact, onSend, onStop, onModel }: { streaming: boolean; compacting: boolean; queueBusy: boolean; readOnly: boolean; leaseOwner?: string; onTakeover: () => void; modelState: ModelState | null; host: PipiHostAPI; sessionId: string; statsRefreshKey: number; visibility: ModelVisibilityController; onOpenModelManager: () => void; onCompact: () => void; onSend: (draft: string, attachments?: PromptAttachment[]) => Promise<boolean>; onStop: () => void; onModel: (state: ModelState) => void }) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashHidden, setSlashHidden] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentsRef = useRef<ComposerAttachment[]>(attachments)
  attachmentsRef.current = attachments

  // Revoke all object URLs when the composer unmounts (no leaks).
  useEffect(() => () => { for (const a of attachmentsRef.current) URL.revokeObjectURL(a.url) }, [])
  // Esc closes the lightbox and the quick menu.
  useEffect(() => {
    if (lightboxIndex === null && !quickOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setLightboxIndex(null); setQuickOpen(false) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, quickOpen])

  const slashQuery = slashPaletteQuery(draft)
  const slashMatches = useMemo(() => (slashQuery === null ? [] : filterSlashCommands(slashQuery)), [slashQuery])
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

  const changeDraft = (value: string) => { setDraft(value); setSlashHidden(false) }
  const dismissSlash = () => setSlashHidden(true)
  const executeSlash = (command: SlashCommandDef) => {
    setSlashHidden(true)
    if (command.action.kind === 'open-model-manager') {
      onOpenModelManager()
      setDraft('') // Swift executeSlash clears the draft before running the command
    } else if (command.action.kind === 'compact') {
      onCompact()
      setDraft('')
    }
  }

  const clearAttachments = () => {
    for (const a of attachmentsRef.current) URL.revokeObjectURL(a.url)
    setAttachments([])
  }
  const removeAttachment = (id: string) => {
    if (readOnly) return
    setAttachments(current => {
      const target = current.find(a => a.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return current.filter(a => a.id !== id)
    })
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
    if (accepted.length) setAttachments(current => [...current, ...accepted])
    if (firstError) setAttachError(firstError)
  }
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return
    const files = imageFilesFromClipboard(event.clipboardData)
    if (files.length) { event.preventDefault(); setAttachError(null); addFiles(files) }
  }

  const submit = async () => {
    if (readOnly) return
    const invocation = parseSlashInvocation(draft)
    const command = invocation ? slashCommandByName(invocation.name) : undefined
    if (command) { executeSlash(command); return }
    const hasText = draft.trim() !== ''
    if (!hasText && attachments.length === 0) return
    if (attachments.length > 0 && modelState?.model && modelState.model.supportsImages === false) {
      setSendError(`当前模型 ${modelState.model.name} 不支持图片附件`)
      return
    }
    setSendError(null)
    try {
      const payload = await Promise.all(attachments.map(toPromptAttachment))
      const ok = await onSend(hasText ? draft : '', payload.length ? payload : undefined)
      if (!ok) return
      clearAttachments()
      setDraft('')
      setAttachError(null)
    } catch (err) {
      setSendError(`发送失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (slashVisible) { event.preventDefault(); dismissSlash() }
      return
    }
    if (event.key === 'ArrowDown' && slashVisible && slashMatches.length) { event.preventDefault(); setSlashIndex(i => Math.min(i + 1, slashMatches.length - 1)); return }
    if (event.key === 'ArrowUp' && slashVisible && slashMatches.length) { event.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return }
    if (event.key === 'Tab' && slashVisible && slashMatches.length) { event.preventDefault(); setDraft(`/${slashMatches[Math.min(slashIndex, slashMatches.length - 1)].name} `); setSlashHidden(true); return }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (slashVisible && slashMatches.length > 0) { executeSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]); return }
      void submit()
    }
  }
  const setThinking = async (level: ThinkingLevel) => onModel(await host.setThinkingLevel(sessionId, level))
  const handleQuickSelect = async (model: Model) => {
    setQuickOpen(false)
    try {
      onModel(await host.setModel(sessionId, model.provider, model.id))
      setSendError(null)
    } catch (err) {
      setSendError(`切换模型失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const canSend = !readOnly && (draft.trim() !== '' || attachments.length > 0)
  const showQueueSubmit = queueBusy && canSend
  return <footer className="composer">
    {readOnly && <div className="composer-read-only" data-testid="composer-read-only" role="status"><span>当前由 {leaseOwner ?? '另一客户端'} 持有，会话只读。</span><button type="button" data-testid="composer-lease-takeover" onClick={onTakeover}>强制接管</button></div>}
    {slashVisible && <SlashMenu commands={slashMatches} selectedIndex={Math.min(slashIndex, Math.max(0, slashMatches.length - 1))} onHighlight={setSlashIndex} onSelect={executeSlash} onDismiss={dismissSlash} />}
    {attachments.length > 0 && <div className="composer-thumbs" data-testid="composer-thumbs">
      {attachments.map((attachment, index) => (
        <div key={attachment.id} className="composer-thumb" data-testid={`composer-thumb-${index}`}>
          <img src={attachment.url} alt={attachment.name} onClick={() => setLightboxIndex(index)} />
          <button className="composer-thumb-remove" aria-label={`移除图片 ${attachment.name}`} disabled={readOnly} onClick={() => removeAttachment(attachment.id)}>×</button>
        </div>
      ))}
    </div>}
    {(attachError || sendError) && <div className="composer-error" data-testid="composer-error"><span>{sendError ?? attachError}</span><button className="composer-error-close" aria-label="关闭错误提示" data-testid="composer-error-close" onClick={() => { setSendError(null); setAttachError(null) }}>×</button></div>}
    <div className="composer-card"><div className="composer-shell"><textarea ref={textareaRef} aria-label="消息输入框" disabled={readOnly} value={draft} placeholder={readOnly ? '会话由另一版本运行中' : queueBusy ? '当前会话忙碌，发送将加入队列…' : '给 PipiUI 发送消息…'} rows={1} onChange={event => changeDraft(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />{streaming && !showQueueSubmit ? <button aria-label="停止生成" className="send stop" onClick={onStop}>■</button> : <button aria-label={queueBusy ? '加入消息队列' : '发送消息'} className="send" disabled={!canSend} onClick={() => void submit()}>↑</button>}</div></div>
    <div className="composer-options"><div className="composer-options-left"><div className="quick-menu-anchor"><button className="model-chip" aria-label="当前模型" title="切换模型" data-testid="model-chip" onClick={() => setQuickOpen(value => !value)}>{modelState?.model && <ProviderLogo provider={modelState.model.provider} modelId={modelState.model.id} size={13} />}<span className="model-chip-name">{modelState?.model.name ?? '加载模型…'}</span></button>{quickOpen && <ModelQuickMenu groups={visibility.quickGroups} current={modelState?.model ?? null} onSelect={model => void handleQuickSelect(model)} onClose={() => setQuickOpen(false)} />}</div><ThinkingChip level={modelState?.thinkingLevel ?? 'medium'} levels={modelState?.availableThinkingLevels ?? ['medium']} onChange={level => void setThinking(level)} /></div><div className="composer-stats" data-testid="composer-session-stats"><SessionStatsPill host={host} sessionId={sessionId} isStreaming={streaming} isCompacting={compacting} refreshKey={statsRefreshKey} /><QuotaPill host={host} sessionId={sessionId} provider={modelState?.model.provider} refreshKey={statsRefreshKey} /><BalancePill host={host} sessionId={sessionId} provider={modelState?.model.provider} refreshKey={statsRefreshKey} /></div></div>
    {lightboxIndex !== null && attachments[lightboxIndex] && <div className="lightbox-backdrop" data-testid="lightbox" onMouseDown={event => { if (event.target === event.currentTarget) setLightboxIndex(null) }}><img src={attachments[lightboxIndex].url} alt="图片预览" /><button className="lightbox-close" aria-label="关闭预览" onClick={() => setLightboxIndex(null)}>×</button></div>}
  </footer>
}
function ToolQuickRail({ activeTab, toolsCollapsed, onSelect, host, browserAvailable, terminalAvailable, subagentsRunning }: { activeTab: PanelTab; toolsCollapsed: boolean; onSelect: (tab: PanelTab) => void; host: PipiHostAPI; browserAvailable: boolean | undefined; terminalAvailable: boolean | undefined; subagentsRunning: boolean }) {
  return <nav className="tool-quick-rail" aria-label="工具面板" data-testid="tool-quick-rail">
    {tabs.map(tab => {
      const browserUnavailable = tab === 'Browser' && (browserAvailable === false || !host.browser)
      const terminalUnavailable = tab === 'Terminal' && (terminalAvailable === false || !host.terminal)
      const unavailable = browserUnavailable || terminalUnavailable
      const unavailableTitle = browserUnavailable ? '当前连接不支持内置浏览器' : '当前连接不支持终端'
      const active = activeTab === tab && !toolsCollapsed
      return <button key={tab} className={`tool-rail-button${active ? ' active' : ''}`} aria-label={tab} aria-current={active ? 'page' : undefined} aria-disabled={unavailable || undefined} disabled={unavailable} title={unavailable ? unavailableTitle : tab} onClick={() => onSelect(tab)}>
        <span className="tool-rail-icon" aria-hidden="true" style={{ width: 13 * toolRailIcons[tab].ratio, WebkitMaskImage: `url(${toolRailIcons[tab].src})`, maskImage: `url(${toolRailIcons[tab].src})` }} />
        {tab === 'Subagents' && subagentsRunning && <span className="tool-rail-running" aria-label="有运行中的 subagent" />}
      </button>
    })}
  </nav>
}
function ToolPanel({ activeTab, host, theme, sessionId, announcedTerminal, revealedTerminalId, onSubagentsRunningChange, browserAvailable, browserOccluded, terminalAvailable, retainedWorktreeDispositionAvailable, projectId, projectPath }: { activeTab: PanelTab; host: PipiHostAPI; theme: 'light' | 'dark'; sessionId?: string; announcedTerminal?: TerminalSession; revealedTerminalId?: string; onSubagentsRunningChange: (running: boolean) => void; browserAvailable: boolean | undefined; browserOccluded: boolean; terminalAvailable: boolean | undefined; retainedWorktreeDispositionAvailable: boolean; projectId?: string; projectPath?: string }) {
  const [terminalMounted, setTerminalMounted] = useState(activeTab === 'Terminal')
  const [documentMounted, setDocumentMounted] = useState(activeTab === 'Document')
  const [browserMounted, setBrowserMounted] = useState(activeTab === 'Browser')
  useEffect(() => {
    if (activeTab === 'Terminal') setTerminalMounted(true)
    if (activeTab === 'Document') setDocumentMounted(true)
    if (activeTab === 'Browser') setBrowserMounted(true)
  }, [activeTab])
  return <aside className="tool-panel">
    <div className="tool-content">
      <div className="tool-page subagent-content" hidden={activeTab !== 'Subagents'}><SubagentPanel host={host} sessionId={sessionId} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} onRunningChange={onSubagentsRunningChange} /></div>
      {activeTab === 'Terminal' && terminalAvailable === false ? <div className="tool-page"><div className="empty-panel" data-testid="terminal-unavailable"><b>Terminal 不可用</b><p>当前连接未提供终端能力。</p></div></div> : terminalMounted || activeTab === 'Terminal' ? <div className="tool-page terminal-content" hidden={activeTab !== 'Terminal'}><TerminalPanel host={host} theme={theme} sessionId={sessionId} announcedTerminal={announcedTerminal} revealedTerminalId={revealedTerminalId} projectId={projectId} projectPath={projectPath} visible={activeTab === 'Terminal'} /></div> : null}
      {documentMounted || activeTab === 'Document' ? <div className="tool-page document-content" hidden={activeTab !== 'Document'}><DocumentPanel host={host} projectId={projectId} /></div> : null}
      {browserMounted || activeTab === 'Browser' ? <div className="tool-page browser-content" hidden={activeTab !== 'Browser'}>{browserAvailable === true && host.browser ? <BrowserPanel host={host} sessionId={sessionId} occluded={browserOccluded || activeTab !== 'Browser'} /> : <div className="empty-panel browser-placeholder" data-testid="browser-unavailable"><b>Browser 不可用</b><p>{browserAvailable === undefined ? '正在检查当前连接的浏览器能力…' : '当前连接未提供桌面浏览器能力。'}</p></div>}</div> : null}
    </div>
  </aside>
}
