import {
  PIPI_HOST_PROTOCOL_VERSION,
  browserMobileDeviceById,
  type BrowserEvent,
  type BrowserHostAPI,
  type BrowserSnapshot,
  type BrowserToolRequest,
  type BrowserToolResult,
  type BrowserTab,
  type BrowserTabOptions,
  type BrowserTabsSnapshot,
  type BrowserViewBounds,
  type HostBackend,
  type HostEvent,
  type HostMethod,
  type Unsubscribe
} from '@pipi/host-api'
import { createHash } from 'node:crypto'
import browserDOMControllerSource from '../../../../resources/runtime/browser-dom/controller.js?raw'
import {
  BROWSER_DEBUG_SCHEMA_VERSION,
  BROWSER_SCRIPT_DEADLINE_MS,
  BROWSER_SCRIPT_MAX_INPUT,
  TabConsoleBuffer,
  buildScriptWrapper,
  clampWaitTimeoutMs,
  formatConsoleLogs,
  remapScriptStack,
  requestIdOf,
  shouldOpenBrowserDevTools,
  truncateEnvelope,
  type BrowserDebugEnvelope,
} from './browser-debug.js'

export { BROWSER_HOST_TOOL_ACTIONS, shouldOpenBrowserDevTools } from './browser-debug.js'

/** Minimal structural types keep this controller unit-testable without Electron. */
export interface BrowserWebContentsLike {
  loadURL(url: string): Promise<unknown> | unknown
  reload(): void
  stop?(): void
  getURL?(): string
  executeJavaScript?(code: string): Promise<unknown>
  capturePage?(rect?: BrowserViewBounds, options?: { stayHidden?: boolean; stayAwake?: boolean }): Promise<{ toPNG(): Uint8Array }>
  close?(options?: { waitForBeforeUnload?: boolean }): void
  isDestroyed?(): boolean
  isCrashed?(): boolean
  getOSProcessId?(): number
  session?: { clearStorageData(): Promise<void>; clearCache(): Promise<void> }
  enableDeviceEmulation?(params: BrowserDeviceEmulation): void
  disableDeviceEmulation?(): void
  setZoomFactor?(factor: number): void
  getZoomFactor?(): number
  setUserAgent?(userAgent: string): void
  getUserAgent?(): string
  on(event: string, listener: (...args: any[]) => void): unknown
  off?(event: string, listener: (...args: any[]) => void): unknown
  openDevTools?(options?: { mode?: string }): void
  isDevToolsOpened?(): boolean
}

export type BrowserDeviceEmulation = {
  screenPosition: 'desktop' | 'mobile'
  screenSize: { width: number; height: number }
  viewPosition: { x: number; y: number }
  deviceScaleFactor: number
  viewSize: { width: number; height: number }
  scale: number
}
export interface BrowserViewLike {
  webContents: BrowserWebContentsLike
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  getBounds?(): { x: number; y: number; width: number; height: number }
  setVisible?(visible: boolean): void
  getVisible?(): boolean
  setBackgroundColor?(color: string): void
}
export type BrowserViewFactory = (options: { webPreferences: { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean; partition?: string } }) => BrowserViewLike
export type BrowserViewPlacement = boolean | 'detach' | 'raise'
type BrowserViewAttach = (view: BrowserViewLike, placement: BrowserViewPlacement, kind: BrowserViewportKind, device: BrowserMobileWindowDevice) => BrowserViewBounds | void
type BrowserSessionViewAttach = (sessionId: string, view: BrowserViewLike, placement: BrowserViewPlacement, kind: BrowserViewportKind, device: BrowserMobileWindowDevice) => BrowserViewBounds | void
type BrowserMobileWindowDevice = BrowserMobileDevice & { deviceId: string; label: string }
type BrowserSpaceEvent =
  | { type: 'tabs'; snapshot: BrowserTabsSnapshot }
  | { type: 'reveal' }
  | { type: 'error'; message: string }
  | { type: 'mobile-window'; open: boolean; deviceId: string }

export interface BrowserViewNativeHostLike {
  contentView: { children?: BrowserViewLike[]; addChildView(view: BrowserViewLike): void; removeChildView(view: BrowserViewLike): void }
}

export interface BrowserShellWindowLike extends BrowserViewNativeHostLike {
  getContentBounds(): { width: number; height: number }
  on(event: 'resize', listener: () => void): unknown
  off(event: 'resize', listener: () => void): unknown
}

/** BaseWindow composition: mount the renderer shell first and keep it full-size. */
export function mountBrowserShellView(window: BrowserShellWindowLike, shellView: BrowserViewLike): () => void {
  const layout = () => {
    const { width, height } = window.getContentBounds()
    shellView.setBounds({ x: 0, y: 0, width, height })
    traceBrowserNative('shell:layout', shellView, window, { requested: { x: 0, y: 0, width, height } })
  }
  window.contentView.addChildView(shellView)
  layout()
  window.on('resize', layout)
  return () => window.off('resize', layout)
}

const browserViewParent = new WeakMap<BrowserViewLike, BrowserViewNativeHostLike>()
const browserViewDebugIds = new WeakMap<BrowserViewLike, number>()
let browserViewDebugSequence = 0
let browserNativeTraceSink: ((entry: Record<string, unknown>) => void) | undefined

export function installBrowserNativeTrace(sink: ((entry: Record<string, unknown>) => void) | undefined): void {
  browserNativeTraceSink = sink
}

function traceBrowserNative(stage: string, view: BrowserViewLike, host?: BrowserViewNativeHostLike, detail: Record<string, unknown> = {}): void {
  if (!browserNativeTraceSink) return
  let viewId = browserViewDebugIds.get(view)
  if (!viewId) {
    viewId = ++browserViewDebugSequence
    browserViewDebugIds.set(view, viewId)
  }
  const childIds = host?.contentView.children?.map(child => {
    let childId = browserViewDebugIds.get(child)
    if (!childId) {
      childId = ++browserViewDebugSequence
      browserViewDebugIds.set(child, childId)
    }
    return childId
  })
  browserNativeTraceSink({
    timestamp: Date.now(),
    stage,
    viewId,
    bounds: view.getBounds?.(),
    visible: view.getVisible?.(),
    childIds,
    ...detail
  })
}

function nativeViewUsable(view: BrowserViewLike | undefined): view is BrowserViewLike {
  const contents = view?.webContents
  return Boolean(contents && typeof contents.loadURL === 'function' && !contents.isDestroyed?.())
}

export function routeBrowserView(
  view: BrowserViewLike,
  placement: BrowserViewPlacement,
  mainHost: BrowserViewNativeHostLike,
  hiddenHost?: BrowserViewNativeHostLike
): void {
  const parent = browserViewParent.get(view)
  if (placement === 'detach' || !nativeViewUsable(view)) {
    try { mainHost.contentView.removeChildView(view) } catch { /* not attached */ }
    try { hiddenHost?.contentView.removeChildView(view) } catch { /* not attached */ }
    browserViewParent.delete(view)
    view.setVisible?.(false)
    traceBrowserNative('route:detach', view, mainHost, { destroyed: !nativeViewUsable(view) })
    return
  }
  const visible = placement
  // A WebContentsView has one stable native owner for its whole lifetime.
  // Electron documents same-parent add as a reorder operation, but does not
  // guarantee that a live Chromium surface can migrate across BaseWindows.
  // Hidden tool browsing therefore stays attached to main with a real viewport
  // and setVisible(false), instead of moving through the transparent host.
  if (placement === 'raise') {
    if (parent === mainHost) {
      try { mainHost.contentView.addChildView(view) } catch { /* same-parent reorder */ }
    }
    traceBrowserNative('route:raise', view, mainHost, { placement })
    return
  }
  if (parent === mainHost) {
    if (!visible) view.setVisible?.(false)
    traceBrowserNative('route:existing-main', view, mainHost, { placement: visible })
    return
  }
  // Clean up a legacy/unknown attachment once, then establish main ownership.
  try { hiddenHost?.contentView.removeChildView(view) } catch { /* not attached */ }
  try { mainHost.contentView.removeChildView(view) } catch { /* not attached */ }
  mainHost.contentView.addChildView(view)
  browserViewParent.set(view, mainHost)
  if (!visible) view.setVisible?.(false)
  traceBrowserNative('route:add-main', view, mainHost, { placement: visible })
}

type BrowserTabRecord = BrowserTab & { history: string[]; historyIndex: number }
type NavigationKind = 'push' | 'history' | 'restore' | 'reload'
type PendingNavigation = { tabId: string; kind: NavigationKind; url: string }

const hiddenBounds: BrowserViewBounds = { x: 0, y: 0, width: 0, height: 0, visible: false }
type BrowserToolTarget = 'active' | 'desktop' | 'mobile' | 'both'
type BrowserViewMode = 'desktop' | 'mobile' | 'compare'
type BrowserViewportKind = 'desktop' | 'mobile'
type BrowserMobileDevice = { width: number; height: number; deviceScaleFactor: number; userAgent?: string }
const BROWSER_DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const
const BROWSER_MOBILE_VIEWPORT = { width: 390, height: 844 } as const
const DEFAULT_MOBILE_DEVICE: BrowserMobileDevice = { width: 390, height: 844, deviceScaleFactor: 2 }
const defaultPartition = 'persist:pipiui-browser'
const unsafeBothActions = new Set(['click', 'input', 'type', 'select', 'scroll', 'eval', 'content', 'console', 'wait'])

export function browserViewportPreset(kind: BrowserViewportKind, device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE): { width: number; height: number } {
  return kind === 'mobile' ? { width: device.width, height: device.height } : BROWSER_DESKTOP_VIEWPORT
}

export function normalizeBrowserViewMode(value: unknown): BrowserViewMode {
  return value === 'mobile' || value === 'compare' ? value : 'desktop'
}

export function normalizeBrowserToolTarget(value: unknown): BrowserToolTarget {
  return value === 'desktop' || value === 'mobile' || value === 'both' ? value : 'active'
}

function requestTarget(request: BrowserToolRequest): unknown {
  return (request as BrowserToolRequest & { target?: unknown }).target
}

function requestElementToken(request: BrowserToolRequest): string | undefined {
  const token = (request as BrowserToolRequest & { element_token?: unknown }).element_token
  return typeof token === 'string' ? token : undefined
}

function boundsMode(bounds: BrowserViewBounds): unknown {
  return (bounds as BrowserViewBounds & { mode?: unknown }).mode
}

function boundsSlots(bounds: BrowserViewBounds): { desktop?: { x: number; y: number; width: number; height: number }; mobile?: { x: number; y: number; width: number; height: number } } | undefined {
  return (bounds as BrowserViewBounds & { slots?: { desktop?: { x: number; y: number; width: number; height: number }; mobile?: { x: number; y: number; width: number; height: number } } }).slots
}

function boundsMobileOverlay(bounds: BrowserViewBounds): BrowserViewBounds['mobileOverlay'] {
  return (bounds as BrowserViewBounds).mobileOverlay
}

function readMobileDevice(bounds: BrowserViewBounds, fallback: BrowserMobileDevice): BrowserMobileDevice {
  const overlay = boundsMobileOverlay(bounds)
  const viewport = overlay?.viewport
  return {
    width: Math.max(1, Math.round(viewport?.width ?? fallback.width)),
    height: Math.max(1, Math.round(viewport?.height ?? fallback.height)),
    deviceScaleFactor: overlay?.deviceScaleFactor && overlay.deviceScaleFactor > 0 ? overlay.deviceScaleFactor : fallback.deviceScaleFactor,
    userAgent: overlay?.userAgent || fallback.userAgent
  }
}

function mobileDeviceChanged(previous: BrowserMobileDevice, next: BrowserMobileDevice): boolean {
  return previous.width !== next.width
    || previous.height !== next.height
    || previous.deviceScaleFactor !== next.deviceScaleFactor
    || previous.userAgent !== next.userAgent
}

export function parseBrowserSnapshotTarget(snapshotId: string | undefined): { kind?: BrowserViewportKind; id: string } {
  if (!snapshotId) return { id: '' }
  const match = /^(desktop|mobile):(.*)$/.exec(snapshotId)
  return match ? { kind: match[1] as BrowserViewportKind, id: match[2] } : { id: snapshotId }
}

export function tagBrowserSnapshotId(id: string, kind: BrowserViewportKind): string {
  return `${kind}:${id}`
}

export function browserDeviceEmulationFor(
  kind: BrowserViewportKind,
  visual: { width: number; height: number },
  device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE
): BrowserDeviceEmulation {
  if (kind !== 'mobile') {
    return {
      screenPosition: 'desktop',
      screenSize: { width: Math.max(1, visual.width), height: Math.max(1, visual.height) },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: 1,
      viewSize: { width: Math.max(1, visual.width), height: Math.max(1, visual.height) },
      scale: 1
    }
  }
  const preset = browserViewportPreset(kind, device)
  const scale = visual.width > 0 && visual.height > 0
    ? Math.min(visual.width / preset.width, visual.height / preset.height)
    : 1
  return {
    screenPosition: 'mobile',
    screenSize: { width: preset.width, height: preset.height },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: device.deviceScaleFactor,
    viewSize: { width: preset.width, height: preset.height },
    scale: scale > 0 ? scale : 1
  }
}

function hiddenPresetBounds(kind: BrowserViewportKind, device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE): BrowserViewBounds {
  const preset = browserViewportPreset(kind, device)
  return { x: 0, y: 0, width: preset.width, height: preset.height, visible: false }
}

function roundRect(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

function setNativeBounds(view: BrowserViewLike, bounds: BrowserViewBounds): void {
  // BrowserViewBounds carries API presentation state; Electron View.setBounds
  // accepts only a native Rectangle. Never leak the custom `visible` key into
  // gin's Rectangle conversion.
  view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
}

function applyViewport(
  view: BrowserViewLike,
  kind: BrowserViewportKind,
  visual: { width: number; height: number },
  emulate: boolean,
  device: BrowserMobileDevice = DEFAULT_MOBILE_DEVICE
): void {
  if (!nativeViewUsable(view) || view.webContents.isCrashed?.()) return
  // Desktop always paints 1:1 into the surface. Mobile uses enableDeviceEmulation
  // scale only — never also zoom, or the page is shrunk twice into the corner.
  view.webContents.setZoomFactor?.(1)
}

/** Stable, opaque profile name: raw session ids never become filesystem path components. */
export function browserPartitionForSession(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 32)
  return `persist:pipiui-browser-${digest}`
}

export function normalizeBrowserURL(value: string): string {
  const input = value.trim()
  if (!input) return ''
  if (/^(about:|file:|https?:\/\/)/i.test(input)) return input
  if (/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input)) return `http://${input}`
  if (/\s/.test(input) || !input.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(input)}`
  return `https://${input}`
}

function tabTitle(url: string): string {
  if (!url || url === 'about:blank') return '新标签页'
  try { return new URL(url).hostname || url } catch { return url }
}

function copyTab(tab: BrowserTabRecord): BrowserTab {
  const { history: _history, historyIndex: _historyIndex, ...publicTab } = tab
  return { ...publicTab }
}

function copyTabs(tabs: BrowserTabRecord[], activeTabId?: string): BrowserTabsSnapshot {
  return { tabs: tabs.map(copyTab), activeTabId }
}

type ViewPane = {
  kind: BrowserViewportKind
  view?: BrowserViewLike
  shownTabId?: string
  loadedUrl?: string
  attachedVisible?: boolean
  pending?: PendingNavigation
}

/**
 * A virtual multi-tab model backed by one physical WebContentsView per viewport.
 * Desktop fills the renderer-owned browser surface. Mobile remains a real,
 * independently responsive page in its framed child window. Both share this
 * browser session's partition, virtual tab, and synchronized URL/history.
 * Switching tabs reloads that tab's retained URL/history; it intentionally never
 * creates a view per tab.
 */
export class BrowserTabsHost {
  private readonly tabs: BrowserTabRecord[] = []
  private readonly listeners = new Set<(event: BrowserSpaceEvent) => void>()
  private readonly revealWaiters = new Set<() => void>()
  private readonly failedLoadViews = new WeakSet<BrowserViewLike>()
  private readonly retiredViews = new WeakSet<BrowserViewLike>()
  private readonly panes: Record<BrowserViewportKind, ViewPane> = {
    desktop: { kind: 'desktop' },
    mobile: { kind: 'mobile' }
  }
  private attach?: BrowserViewAttach
  private activeTabId?: string
  private toolRevealPending = false
  private toolNavigationPending = false
  private mode: BrowserViewMode = 'desktop'
  private mobileOverlayVisible = false
  private applyMobileEmulation = true
  private mobileDevice: BrowserMobileDevice = { ...DEFAULT_MOBILE_DEVICE }
  private mobileDeviceId = 'responsive'
  private mobileWindowViewport: BrowserViewBounds = { x: 0, y: 0, width: DEFAULT_MOBILE_DEVICE.width, height: DEFAULT_MOBILE_DEVICE.height, visible: false }
  private bounds: BrowserViewBounds & { mode?: BrowserViewMode; slots?: { desktop?: { x: number; y: number; width: number; height: number }; mobile?: { x: number; y: number; width: number; height: number } } } = hiddenBounds
  private sequence = 0
  /** Virtual tab that owns the currently committed main-frame document. */
  private documentOwnerTabId?: string
  /** Tab that will own the document after the in-flight main-frame commit. */
  private pendingDocumentOwnerTabId?: string
  private navigationGeneration = 0
  private viewGeneration = 0
  private readonly consoles = new TabConsoleBuffer()
  private readonly consoleListeners = new WeakMap<BrowserWebContentsLike, (...args: any[]) => void>()

  constructor(private readonly createView: BrowserViewFactory, private readonly partition = defaultPartition) {
    this.createTab()
  }

  /** A later BrowserWindow can become the sole owner after the prior one closes. */
  attachToWindow(attach: BrowserViewAttach): void {
    // Views cannot migrate across BaseWindows. Detach and close every live pane
    // so the old window does not keep orphaned WebContents / partitions.
    for (const pane of this.allPanes()) this.resetPane(pane, true)
    this.resetDocumentOwnership()
    this.attach = attach
  }

  detachWindow(): void {
    for (const pane of this.allPanes()) this.resetPane(pane, true)
    this.resetDocumentOwnership()
    this.attach = undefined
  }

  async listTabs(): Promise<BrowserTabsSnapshot> { return this.state() }
  async getActiveTab(): Promise<BrowserTab | undefined> { return this.active ? copyTab(this.active) : undefined }

  async newTab(options: BrowserTabOptions = {}): Promise<BrowserTab> {
    const tab = this.createTab(options)
    this.activeTabId = tab.id
    this.emit()
    await this.show(tab, 'restore')
    return copyTab(tab)
  }

  async switchTab(tabId: string): Promise<BrowserTab> {
    const tab = this.requireTab(tabId)
    this.activeTabId = tab.id
    this.emit()
    await this.show(tab, 'restore')
    return copyTab(tab)
  }

  async closeTab(tabId: string): Promise<BrowserTabsSnapshot> {
    const index = this.tabs.findIndex(tab => tab.id === tabId)
    if (index < 0) throw new Error(`unknown browser tab: ${tabId}`)
    const wasActive = this.activeTabId === tabId
    this.tabs.splice(index, 1)
    if (this.tabs.length === 0) {
      const fresh = this.createTab()
      this.activeTabId = fresh.id
    } else if (wasActive) {
      this.activeTabId = this.tabs[Math.min(index, this.tabs.length - 1)].id
    }
    if (wasActive) for (const pane of this.createdPanes()) pane.view?.webContents.stop?.()
    this.consoles.clearTab(tabId)
    this.emit()
    if (this.active) await this.show(this.active, 'restore')
    return this.state()
  }

  async loadURL(url: string, tabId?: string): Promise<BrowserTab> {
    const target = normalizeBrowserURL(url)
    if (!target) throw new Error('请输入网址或搜索内容。')
    const tab = this.activate(tabId)
    this.pushHistory(tab, target)
    tab.title = tabTitle(target)
    this.emit()
    await this.show(tab, 'push')
    return copyTab(tab)
  }

  async goBack(tabId?: string): Promise<BrowserTab> {
    const tab = this.activate(tabId)
    if (tab.historyIndex <= 0) return copyTab(tab)
    tab.historyIndex -= 1
    tab.url = tab.history[tab.historyIndex]
    tab.title = tabTitle(tab.url)
    this.emit()
    await this.show(tab, 'history')
    return copyTab(tab)
  }

  async goForward(tabId?: string): Promise<BrowserTab> {
    const tab = this.activate(tabId)
    if (tab.historyIndex >= tab.history.length - 1) return copyTab(tab)
    tab.historyIndex += 1
    tab.url = tab.history[tab.historyIndex]
    tab.title = tabTitle(tab.url)
    this.emit()
    await this.show(tab, 'history')
    return copyTab(tab)
  }

  async reload(tabId?: string): Promise<BrowserTab> {
    const tab = this.activate(tabId)
    const pane = this.primaryPaneIfCreated()
    if (!this.isVisible() || !pane?.view) return copyTab(tab)
    tab.isLoading = true
    this.emit()
    pane.pending = { tabId: tab.id, kind: 'reload', url: tab.url || 'about:blank' }
    pane.view.webContents.reload()
    return copyTab(tab)
  }

  async snapshot(tabId?: string): Promise<BrowserSnapshot> {
    const tab = this.tabFor(tabId)
    const snapshot: BrowserSnapshot = { tabId: tab.id, url: tab.url, title: tab.title, isLoading: tab.isLoading }
    const pane = this.primaryPaneIfCreated()
    const evaluate = pane?.view?.webContents.executeJavaScript
    if (!pane || tab.id !== this.activeTabId || tab.id !== pane.shownTabId || !evaluate) return snapshot
    try {
      const text = await evaluate.call(pane.view!.webContents, 'document.body?.innerText ?? ""')
      if (typeof text === 'string') snapshot.text = text
    } catch {
      // Navigation races and restricted pages can reject evaluation; metadata
      // remains useful and matches the pre-text snapshot contract.
    }
    return snapshot
  }

  async toolAction(request: BrowserToolRequest, options: { reveal?: boolean } = {}): Promise<BrowserToolResult> {
    const startedAt = Date.now()
    this.traceAction('action:start', request, { start: startedAt })
    try {
      if (options.reveal !== false) await this.revealForTool()
      const resolved = this.resolveToolTargets(request)
      if ('error' in resolved) return { ok: false, error: resolved.error }
      if (request.action === 'navigate') {
        if (!request.url) return { ok: false, error: 'browser navigate requires url' }
        await this.loadURLForTool(request.url)
        return this.observeTargets(resolved.kinds, request.scope ?? 'viewport')
      }
      if (request.action === 'back') { await this.goBack(); if (this.active) await this.show(this.active, 'history', true); return this.observeTargets(resolved.kinds, request.scope ?? 'viewport') }
      if (request.action === 'forward') { await this.goForward(); if (this.active) await this.show(this.active, 'history', true); return this.observeTargets(resolved.kinds, request.scope ?? 'viewport') }
      if (request.action === 'reload') { if (this.active) await this.show(this.active, 'reload', true); return this.observeTargets(resolved.kinds, request.scope ?? 'viewport') }
      if (request.action === 'screenshot') return this.screenshotTargets(resolved.kinds)
      if (request.action === 'type') {
        if (request.selector) return this.selectorAction({ ...request, action: 'input', mode: 'append' }, resolved.kinds[0])
        return this.domActionOn({ ...request, action: 'input', text: request.text ?? '' }, resolved.kinds[0])
      }
      if (request.selector && (request.action === 'click' || request.action === 'input')) {
        return this.selectorAction(request, resolved.kinds[0])
      }
      // eval/content run against the live page directly; the structured DOM
      // controller only models observe/click/input/select/scroll, so routing
      // these through domAction would surface "unsupported browser action".
      if (request.action === 'eval') return this.evalAction(request, resolved.kinds[0])
      if (request.action === 'script') return this.scriptAction(request, resolved.kinds[0])
      if (request.action === 'wait') return this.waitAction(request, resolved.kinds[0])
      if (request.action === 'console') return this.consoleAction(request, resolved.kinds[0])
      if (request.action === 'content') return this.contentAction(request, resolved.kinds[0])
      if (['observe', 'click', 'input', 'select', 'scroll'].includes(request.action)) {
        if (request.action === 'observe') return this.observeTargets(resolved.kinds, request.scope ?? 'viewport')
        return this.domActionOn(request, resolved.kinds[0])
      }
      return this.debugEnvelope(request, { ok: false, code: 'unknown_action', error: `unknown browser action: ${request.action}` })
    } catch (error) {
      const failed = this.debugEnvelope(request, { ok: false, startedAt, error: error instanceof Error ? error.message : String(error) })
      this.traceAction('action:end', request, { end: Date.now(), duration: Date.now() - startedAt, error: failed.code || 'error' })
      return failed
    } finally {
      this.traceAction('action:end', request, { end: Date.now(), duration: Date.now() - startedAt })
    }
  }

  private pageContext(kind: BrowserViewportKind) {
    const pane = this.panes[kind]
    return {
      kind,
      tabId: this.active?.id,
      contents: pane.view?.webContents,
      navigationGeneration: this.navigationGeneration,
      viewGeneration: this.viewGeneration,
    }
  }

  private contextDrift(started: ReturnType<BrowserTabsHost['pageContext']>): 'navigation_interrupted' | 'view_recreated' | undefined {
    const pane = this.panes[started.kind]
    if (this.viewGeneration !== started.viewGeneration || pane.view?.webContents !== started.contents) return 'view_recreated'
    if (pane.shownTabId !== started.tabId || this.active?.id !== started.tabId || this.navigationGeneration !== started.navigationGeneration) {
      return 'navigation_interrupted'
    }
    return undefined
  }

  private debugEnvelope(request: BrowserToolRequest, extra: Record<string, unknown> = {}): BrowserDebugEnvelope {
    const requestId = requestIdOf(request as { requestID?: unknown; requestId?: unknown })
    const startedAt = typeof extra.startedAt === 'number' ? extra.startedAt : Date.now()
    const { startedAt: _s, ...rest } = extra
    const tabId = this.active?.id
    const url = this.active?.url || this.primaryPaneIfCreated()?.loadedUrl
    const failed = rest.ok === false
    const tail = failed && tabId ? this.consoles.tail(tabId) : undefined
    const payload: BrowserDebugEnvelope = {
      schemaVersion: BROWSER_DEBUG_SCHEMA_VERSION,
      ok: rest.ok !== false,
      requestId,
      action: String(request.action || ''),
      tabId,
      url,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      ...(tail && tail.length ? { consoleTail: tail } : {}),
      ...rest,
    }
    const packed = truncateEnvelope(payload)
    if (packed.truncated) packed.value.truncated = true
    return packed.value as BrowserDebugEnvelope
  }

  private traceAction(stage: string, request: BrowserToolRequest, extra: Record<string, unknown> = {}): void {
    if (!browserNativeTraceSink) return
    browserNativeTraceSink({
      timestamp: Date.now(),
      stage,
      requestId: requestIdOf(request as { requestID?: unknown; requestId?: unknown }),
      action: request.action,
      ...extra,
    })
  }

  private resolveToolTargets(request: BrowserToolRequest): { kinds: BrowserViewportKind[] } | { error: string } {
    const explicit = requestTarget(request)
    const target = normalizeBrowserToolTarget(explicit)
    const snapshot = parseBrowserSnapshotTarget(typeof request.snapshot_id === 'string' ? request.snapshot_id : undefined)
    const token = parseBrowserSnapshotTarget(requestElementToken(request))
    if (snapshot.kind && token.kind && snapshot.kind !== token.kind) {
      return { error: `browser snapshot belongs to ${snapshot.kind} and cannot be used on ${token.kind}` }
    }
    const inferred = snapshot.kind ?? token.kind
    if (target === 'both' && unsafeBothActions.has(request.action)) {
      return { error: `browser ${request.action} cannot target both viewports; specify target=desktop or target=mobile` }
    }
    if (inferred && target === 'both') {
      return { error: `browser snapshot cannot be used with target=both` }
    }
    const kinds: BrowserViewportKind[] = target === 'both'
      ? ['desktop', 'mobile']
      : target === 'desktop' || target === 'mobile'
        ? [target]
        : inferred
          ? [inferred]
          : [this.primaryKind()]
    if (inferred && !kinds.includes(inferred)) {
      return { error: `browser snapshot belongs to ${inferred} and cannot be used on ${kinds.join('+')}` }
    }
    return { kinds }
  }

  private untaggedRequest(request: Record<string, unknown>, kind: BrowserViewportKind): Record<string, unknown> {
    const snapshot = parseBrowserSnapshotTarget(typeof request.snapshot_id === 'string' ? request.snapshot_id : undefined)
    const token = parseBrowserSnapshotTarget(typeof request.element_token === 'string' ? request.element_token : undefined)
    const next = { ...request }
    if (snapshot.kind === kind) next.snapshot_id = snapshot.id
    if (token.kind === kind) next.element_token = token.id
    return next
  }

  private tagObservation(result: BrowserToolResult, kind: BrowserViewportKind): BrowserToolResult {
    const snapshotID = typeof result.snapshotID === 'string' ? tagBrowserSnapshotId(result.snapshotID, kind) : result.snapshotID
    const elements = Array.isArray(result.elements)
      ? result.elements.map(element => {
          if (!element || typeof element !== 'object') return element
          const record = element as { token?: unknown }
          if (typeof record.token !== 'string') return element
          return { ...record, token: tagBrowserSnapshotId(record.token, kind) }
        })
      : result.elements
    return { ...result, snapshotID, elements, viewportTarget: kind }
  }

  private async observeTargets(kinds: BrowserViewportKind[], scope: string): Promise<BrowserToolResult> {
    if (kinds.length === 1) return this.domActionOn({ action: 'observe', scope }, kinds[0])
    const desktop = this.tagObservation(await this.domActionOn({ action: 'observe', scope }, 'desktop'), 'desktop')
    const mobile = this.tagObservation(await this.domActionOn({ action: 'observe', scope }, 'mobile'), 'mobile')
    const ok = desktop.ok === true && mobile.ok === true
    return {
      ok,
      target: 'both',
      desktop,
      mobile,
      error: ok ? undefined : [desktop.ok ? undefined : `desktop: ${desktop.error ?? 'failed'}`, mobile.ok ? undefined : `mobile: ${mobile.error ?? 'failed'}`].filter(Boolean).join('; ')
    }
  }

  private async screenshotTargets(kinds: BrowserViewportKind[]): Promise<BrowserToolResult> {
    const shots = []
    for (const kind of kinds) {
      const shot = await this.screenshotPane(kind)
      if (!shot.ok) return shot
      shots.push(shot)
    }
    if (shots.length === 1) return shots[0]
    return {
      ok: true,
      target: 'both',
      images: shots.map(shot => ({
        viewport: shot.viewport as BrowserViewportKind,
        base64: String(shot.base64),
        mimeType: String(shot.mimeType ?? 'image/png'),
        width: typeof shot.width === 'number' ? shot.width : undefined,
        height: typeof shot.height === 'number' ? shot.height : undefined
      }))
    }
  }

  private async screenshotPane(kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const preset = kind === 'mobile' ? browserViewportPreset(kind, this.mobileDevice) : this.slotFor('desktop')
    const pane = await this.ensureToolPage(kind)
    const wakeHiddenMobile = kind === 'mobile' && !this.isPresented(kind)
    const view = pane.view
    const wasVisible = view?.getVisible?.() ?? this.isPresented(kind)
    if (wakeHiddenMobile) view?.setVisible?.(true)
    try {
      const view = pane.view
      const image = await view?.webContents.capturePage?.(undefined, {
        stayHidden: kind === 'mobile' ? false : !this.isPresented('desktop')
      })
      if (!image) return { ok: false, error: `browser screenshot is unavailable for ${kind}` }
      const png = image.toPNG()
      if (!png) return { ok: false, error: `browser screenshot is empty for ${kind}` }
      const bytes = Buffer.from(png)
      if (bytes.length === 0) return { ok: false, error: `browser screenshot is empty for ${kind}` }
      return { ok: true, base64: bytes.toString('base64'), mimeType: 'image/png', viewport: kind, width: preset.width, height: preset.height }
    } finally {
      if (wakeHiddenMobile) view?.setVisible?.(wasVisible)
    }
  }

  private async evalAction(request: BrowserToolRequest, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    const execute = pane.view?.webContents.executeJavaScript
    if (!execute || !this.active || pane.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    if (typeof request.js !== 'string' || request.js.length === 0) return { ok: false, error: 'browser eval requires js' }
    try {
      const result = await execute.call(pane.view!.webContents, request.js)
      return { ok: true, result, viewportTarget: kind }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private controllerPrelude(): string {
    return `if(!globalThis.__pipiBrowserDOM||typeof globalThis.__pipiBrowserDOM.resolveElement!=="function"){${browserDOMControllerSource}}\n`
  }

  private async scriptAction(request: BrowserToolRequest, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    return this.scriptActionOnPane(request, kind, pane)
  }

  private async scriptActionOnPane(request: BrowserToolRequest, kind: BrowserViewportKind, pane: ViewPane): Promise<BrowserToolResult> {
    const startedAt = Date.now()
    const execute = pane.view?.webContents.executeJavaScript
    if (!execute || !this.active || pane.shownTabId !== this.active.id) {
      return this.debugEnvelope(request, { ok: false, startedAt, code: 'page_unavailable', error: 'browser page is unavailable' })
    }
    if (typeof request.js !== 'string' || request.js.length === 0) {
      return this.debugEnvelope(request, { ok: false, startedAt, code: 'invalid_input', error: 'browser script requires js' })
    }
    if (request.js.length > BROWSER_SCRIPT_MAX_INPUT) {
      return this.debugEnvelope(request, { ok: false, startedAt, code: 'invalid_input', error: `browser script exceeds ${BROWSER_SCRIPT_MAX_INPUT} UTF-16 units` })
    }
    const ctx = this.pageContext(kind)
    const requestId = requestIdOf(request as { requestID?: unknown; requestId?: unknown })
    const wrapped = buildScriptWrapper(request.js, requestId, BROWSER_SCRIPT_DEADLINE_MS)
    const source = `${this.controllerPrelude()};${wrapped.source}`
    try {
      const raw = await execute.call(pane.view!.webContents, source) as Record<string, unknown> | undefined
      const drift = this.contextDrift(ctx)
      if (drift) {
        return this.debugEnvelope(request, {
          ok: false,
          startedAt,
          code: drift,
          error: drift === 'view_recreated' ? 'browser view was recreated during script' : 'browser navigated or switched tab during script',
          partialSideEffects: true,
        })
      }
      if (!raw || typeof raw !== 'object') {
        return this.debugEnvelope(request, { ok: false, startedAt, code: 'unsupported_result', error: 'browser script returned no result', partialSideEffects: true })
      }
      if (raw.ok === false) {
        let stack = typeof raw.stack === 'string' ? raw.stack : undefined
        let line = typeof raw.line === 'number' ? raw.line : undefined
        let column = typeof raw.column === 'number' ? raw.column : undefined
        if (stack && typeof raw.sourceURL === 'string') {
          const mapped = remapScriptStack(stack, raw.sourceURL, typeof raw.headerLines === 'number' ? raw.headerLines : wrapped.headerLines)
          stack = mapped.stack
          line = mapped.line ?? line
          column = mapped.column ?? column
        }
        return this.debugEnvelope(request, {
          ok: false,
          startedAt,
          code: typeof raw.code === 'string' ? raw.code : 'script_error',
          error: typeof raw.error === 'string' ? raw.error : 'browser script failed',
          stack,
          line,
          column,
          steps: raw.steps,
          lastStep: raw.lastStep,
          truncated: raw.truncated === true,
          partialSideEffects: true,
        })
      }
      let result: unknown = raw.result
      if (typeof raw.resultJson === 'string') {
        try { result = JSON.parse(raw.resultJson) } catch { result = raw.resultJson }
      }
      return this.debugEnvelope(request, {
        ok: true,
        startedAt,
        result,
        steps: raw.steps,
        lastStep: raw.lastStep,
        truncated: raw.truncated === true,
      })
    } catch (error) {
      const drift = this.contextDrift(ctx)
      if (drift) {
        return this.debugEnvelope(request, { ok: false, startedAt, code: drift, error: 'browser page changed during script', partialSideEffects: true })
      }
      return this.debugEnvelope(request, {
        ok: false,
        startedAt,
        code: 'script_error',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        partialSideEffects: true,
      })
    }
  }

  private async waitAction(request: BrowserToolRequest, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    return this.waitActionOnPane(request, kind, pane)
  }

  private async waitActionOnPane(request: BrowserToolRequest, kind: BrowserViewportKind, pane: ViewPane): Promise<BrowserToolResult> {
    const startedAt = Date.now()
    if (!pane.view?.webContents.executeJavaScript || !this.active || pane.shownTabId !== this.active.id) {
      return this.debugEnvelope(request, { ok: false, startedAt, code: 'page_unavailable', error: 'browser page is unavailable' })
    }
    const mode = request.mode === 'selector' || request.mode === 'idle'
      ? request.mode
      : (request.selector || request.element_token || typeof request.element_index === 'number' ? 'selector' : 'idle')
    const timeoutMs = clampWaitTimeoutMs((request as { timeout?: number }).timeout)
    const ctx = this.pageContext(kind)
    let timer: ReturnType<typeof setTimeout> | undefined
    const sleep = (ms: number) => new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })
    try {
      while (Date.now() - startedAt < timeoutMs) {
        const drift = this.contextDrift(ctx)
        if (drift) {
          return this.debugEnvelope(request, {
            ok: false,
            startedAt,
            code: drift,
            error: drift === 'view_recreated' ? 'browser view was recreated during wait' : 'browser navigated or switched tab during wait',
          })
        }
        const check = await this.domActionOnPane({
          action: 'wait_check',
          mode,
          scope: request.scope ?? 'viewport',
          selector: request.selector,
          idle_ms: (request as { idle_ms?: number }).idle_ms,
          snapshot_id: request.snapshot_id,
          element_index: request.element_index,
          element_token: request.element_token,
        }, kind, pane) as Record<string, unknown>
        if (check.ok === false && (check.code === 'invalid_browser_wait' || check.code === 'invalid_browser_target')) {
          return this.debugEnvelope(request, { ok: false, startedAt, code: String(check.code), error: String(check.error || 'invalid wait') })
        }
        if (check.ok !== false && check.ready === true) {
          const observation = await this.domActionOnPane({ action: 'observe', scope: request.scope ?? 'viewport' }, kind, pane)
          return this.debugEnvelope(request, { ...observation, ok: true, startedAt, mode, ready: true })
        }
        const remaining = timeoutMs - (Date.now() - startedAt)
        if (remaining <= 0) break
        await sleep(Math.min(80, remaining))
      }
      return this.debugEnvelope(request, {
        ok: false,
        startedAt,
        code: 'timeout',
        error: 'browser wait timed out',
        mode,
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async consoleAction(request: BrowserToolRequest, _kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const startedAt = Date.now()
    await this.ensureToolPage(_kind)
    const tabId = this.active?.id
    if (!tabId) return this.debugEnvelope(request, { ok: false, startedAt, code: 'page_unavailable', error: 'browser page is unavailable' })
    const extra = request as { sinceSeq?: number; since_seq?: number; level?: string; limit?: number; clear?: boolean }
    const queried = this.consoles.query(tabId, {
      sinceSeq: extra.sinceSeq ?? extra.since_seq,
      level: extra.level,
      limit: extra.limit,
      clear: extra.clear === true,
    })
    const formatted = formatConsoleLogs(queried.entries)
    return this.debugEnvelope(request, {
      ok: true,
      startedAt,
      entries: queried.entries,
      logs: formatted.logs,
      truncated: queried.truncated || formatted.truncated,
    })
  }

  private async contentAction(request: BrowserToolRequest, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    const execute = pane.view?.webContents.executeJavaScript
    if (!execute || !this.active || pane.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    const htmlMode = request.mode === 'html'
    // Read-only page dump composed as a static script; the mode flag is the
    // only interpolated value and it is a validated boolean.
    const source = `(() => { const html = ${JSON.stringify(htmlMode)}; return { title: document.title, url: location.href, content: html ? document.documentElement.outerHTML : (document.body ? document.body.innerText : "") }; })()`
    try {
      const raw = await execute.call(pane.view!.webContents, source) as { content?: unknown } | undefined
      const full = typeof raw?.content === 'string' ? raw.content : ''
      const truncated = full.length > 100_000
      return { ok: true, content: truncated ? full.slice(0, 100_000) : full, truncated, viewportTarget: kind }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async domActionOn(request: Record<string, unknown>, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    return this.domActionOnPane(request, kind, pane)
  }

  private async domActionOnPane(request: Record<string, unknown>, kind: BrowserViewportKind, pane: ViewPane): Promise<BrowserToolResult> {
    const execute = pane.view?.webContents.executeJavaScript
    if (!execute || !this.active || pane.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    const dispatched = this.untaggedRequest(request, kind)
    const source = `if(!globalThis.__pipiBrowserDOM){${browserDOMControllerSource}}\n;globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify(dispatched)})`
    const result = await execute.call(pane.view!.webContents, source)
    if (!result || typeof result !== 'object') return { ok: false, error: 'browser action returned no result' }
    return this.tagObservation(result as BrowserToolResult, kind)
  }

  private async ensureToolPage(kind: BrowserViewportKind): Promise<ViewPane> {
    const tab = this.active ?? this.createTab()
    const pane = this.ensurePane(kind)
    if (!pane.view || pane.shownTabId !== tab.id) await this.showPane(pane, tab, 'restore', true)
    return pane
  }

  private async loadURLForTool(url: string): Promise<void> {
    const target = normalizeBrowserURL(url)
    if (!target) throw new Error('请输入网址或搜索内容。')
    this.toolNavigationPending = true
    try {
      const tab = this.activate()
      this.pushHistory(tab, target)
      tab.title = tabTitle(target)
      this.emit()
      await this.show(tab, 'push', true)
    } finally {
      this.toolNavigationPending = false
    }
  }

  private async selectorAction(request: BrowserToolRequest, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    const execute = pane.view?.webContents.executeJavaScript
    if (!execute) return { ok: false, error: 'browser page is unavailable' }
    const selector = JSON.stringify(request.selector)
    const text = JSON.stringify(request.text ?? '')
    const append = request.action === 'input' && request.mode === 'append'
    const code = `(()=>{const e=document.querySelector(${selector});if(!e)return {ok:false,error:'selector not found'};if(${JSON.stringify(request.action)}==='click'){e.click();return {ok:true}};const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;p?p.call(e,${append ? `String(e.value??'')+${text}` : text}):e.value=${text};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()`
    const result = await execute.call(pane.view!.webContents, code)
    if (!result || typeof result !== 'object' || !(result as any).ok) return result as BrowserToolResult
    return this.domActionOnPane({ action: 'observe', scope: request.scope ?? 'viewport' }, kind, pane)
  }

  async setViewBounds(bounds: BrowserViewBounds, restoreActivePage = true): Promise<boolean> {
    const nextMode = boundsMode(bounds)
    this.mode = nextMode === undefined ? this.mode : normalizeBrowserViewMode(nextMode)
    const overlay = boundsMobileOverlay(bounds)
    let deviceChanged = false
    if (overlay) {
      this.mobileOverlayVisible = overlay.visible === true
      this.applyMobileEmulation = overlay.applyDeviceEmulation !== false
      this.mobileDeviceId = overlay.deviceId || this.mobileDeviceId
      const nextDevice = readMobileDevice(bounds, this.mobileDevice)
      deviceChanged = mobileDeviceChanged(this.mobileDevice, nextDevice)
      this.mobileDevice = nextDevice
    } else if (nextMode !== undefined) {
      this.mobileOverlayVisible = this.mode === 'mobile' || this.mode === 'compare'
      this.applyMobileEmulation = true
    }
    this.bounds = {
      x: roundRect(bounds.x),
      y: roundRect(bounds.y),
      width: roundRect(bounds.width),
      height: roundRect(bounds.height),
      visible: bounds.visible !== false,
      mode: this.mode,
      slots: boundsSlots(bounds),
      mobileOverlay: overlay
    }
    if (!this.isVisible()) {
      for (const pane of this.createdPanes()) this.presentPane(pane, false)
      return false
    }
    this.ensurePanesForMode()
    for (const pane of this.createdPanes()) {
      this.presentPane(pane, this.isPresented(pane.kind))
      if (pane.kind === 'mobile') this.applyDeviceEmulationIfSafe(pane)
    }
    if (deviceChanged) this.reloadMobileForDeviceChange()
    this.revealWaiters.forEach(resolve => resolve())
    this.revealWaiters.clear()
    const activeHasPage = Boolean(this.active && (this.active.history.length > 0 || this.active.url))
    const needsRestore = !this.toolRevealPending && !this.toolNavigationPending && activeHasPage && this.active && this.createdPanes().some(pane => pane.shownTabId !== this.active!.id)
    if (restoreActivePage && needsRestore) void this.restoreVisiblePage()
    return Boolean(needsRestore)
  }

  mobileWindowResized(size: { width: number; height: number }): void {
    this.mobileWindowViewport = { x: 0, y: 0, width: roundRect(size.width), height: roundRect(size.height), visible: true }
    const pane = this.panes.mobile
    if (!this.mobileOverlayVisible || !this.viewUsable(pane.view)) return
    setNativeBounds(pane.view, this.mobileWindowViewport)
    applyViewport(pane.view, 'mobile', this.mobileWindowViewport, true, this.mobileDevice)
    this.applyDeviceEmulationIfSafe(pane)
  }

  mobileWindowClosed(): void {
    if (!this.mobileOverlayVisible) return
    this.mobileOverlayVisible = false
    const pane = this.panes.mobile
    if (this.viewUsable(pane.view)) this.presentPane(pane, false)
    this.listeners.forEach(listener => listener({ type: 'mobile-window', open: false, deviceId: this.mobileDeviceId }))
  }

  async restoreVisiblePage(): Promise<void> {
    const active = this.active
    if (!this.isVisible() || this.toolRevealPending || this.toolNavigationPending || !active) return
    if (!active.history.length && !active.url) return
    if (this.createdPanes().every(pane => pane.shownTabId === active.id)) return
    await this.show(active, 'restore')
  }

  subscribe(listener: (event: BrowserSpaceEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Session deletion is terminal: destroy its page and erase that partition's browsing data. */
  async dispose(clearStorage = false): Promise<void> {
    this.bounds = hiddenBounds
    this.revealWaiters.forEach(resolve => resolve())
    this.revealWaiters.clear()
    const contentsList = this.createdPanes().map(pane => pane.view ? this.beginViewRetirement(pane, pane.view) : undefined).filter(Boolean) as BrowserWebContentsLike[]
    this.consoles.clearAll()
    this.resetDocumentOwnership()
    this.viewGeneration += 1
    this.attach = undefined
    const first = contentsList[0]
    if (!first) return
    if (clearStorage && first.session) {
      await Promise.allSettled([
        first.session.clearStorageData(),
        first.session.clearCache()
      ])
    }
    for (const contents of contentsList) {
      if (!contents.isDestroyed?.()) contents.close?.()
    }
  }

  private get active(): BrowserTabRecord | undefined {
    return this.activeTabId ? this.tabs.find(tab => tab.id === this.activeTabId) : undefined
  }

  private state(): BrowserTabsSnapshot { return copyTabs(this.tabs, this.activeTabId) }

  private async revealForTool(): Promise<void> {
    if (this.isVisible()) return
    this.toolRevealPending = true
    try {
      await this.requestReveal()
    } finally {
      this.toolRevealPending = false
    }
  }

  private createTab(options: BrowserTabOptions = {}): BrowserTabRecord {
    const url = options.url ? normalizeBrowserURL(options.url) : ''
    const tab: BrowserTabRecord = {
      id: `browser-tab-${++this.sequence}`,
      title: tabTitle(url),
      url,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      partition: this.partition,
      history: url ? [url] : [],
      historyIndex: url ? 0 : -1
    }
    this.tabs.push(tab)
    this.activeTabId ??= tab.id
    return tab
  }

  private requireTab(tabId: string): BrowserTabRecord {
    const tab = this.tabs.find(item => item.id === tabId)
    if (!tab) throw new Error(`unknown browser tab: ${tabId}`)
    return tab
  }

  private tabFor(tabId?: string): BrowserTabRecord {
    return tabId ? this.requireTab(tabId) : this.active ?? this.createTab()
  }

  private activate(tabId?: string): BrowserTabRecord {
    const tab = this.tabFor(tabId)
    this.activeTabId = tab.id
    return tab
  }

  private pushHistory(tab: BrowserTabRecord, url: string): void {
    if (tab.history[tab.historyIndex] === url) {
      tab.url = url
    } else {
      tab.history.splice(tab.historyIndex + 1)
      tab.history.push(url)
      tab.historyIndex = tab.history.length - 1
      tab.url = url
    }
    this.syncNavigationButtons(tab)
  }

  private syncNavigationButtons(tab: BrowserTabRecord): void {
    tab.canGoBack = tab.historyIndex > 0
    tab.canGoForward = tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1
  }

  private isVisible(): boolean {
    return this.bounds.visible !== false && this.bounds.width > 0 && this.bounds.height > 0
  }

  private primaryKind(): BrowserViewportKind {
    return 'desktop'
  }

  private allPanes(): ViewPane[] {
    return [this.panes.desktop, this.panes.mobile]
  }

  private createdPanes(): ViewPane[] {
    return this.allPanes().filter(pane => this.viewUsable(pane.view))
  }

  private primaryPaneIfCreated(): ViewPane | undefined {
    const pane = this.panes[this.primaryKind()]
    return this.viewUsable(pane.view) ? pane : this.createdPanes()[0]
  }

  private isPresented(kind: BrowserViewportKind): boolean {
    if (!this.isVisible()) return false
    if (kind === 'desktop') return true
    return this.mobileOverlayVisible
  }

  private ensurePanesForMode(): void {
    this.ensurePane('desktop')
    if (this.mobileOverlayVisible) this.ensurePane('mobile')
  }

  private slotFor(kind: BrowserViewportKind): BrowserViewBounds {
    const slot = boundsSlots(this.bounds)?.[kind]
    if (kind === 'desktop') {
      if (slot && slot.width > 0 && slot.height > 0) {
        return { x: roundRect(slot.x), y: roundRect(slot.y), width: roundRect(slot.width), height: roundRect(slot.height), visible: true }
      }
      return { x: this.bounds.x, y: this.bounds.y, width: this.bounds.width, height: this.bounds.height, visible: true }
    }
    if (this.mobileWindowViewport.width > 0 && this.mobileWindowViewport.height > 0) {
      return { ...this.mobileWindowViewport, visible: true }
    }
    if (slot && slot.width > 0 && slot.height > 0) {
      return { x: roundRect(slot.x), y: roundRect(slot.y), width: roundRect(slot.width), height: roundRect(slot.height), visible: true }
    }
    return { x: this.bounds.x, y: this.bounds.y, width: this.bounds.width, height: this.bounds.height, visible: true }
  }

  private applyDeviceEmulationIfSafe(pane: ViewPane): void {
    const view = pane.view
    if (!this.viewUsable(view) || view.webContents.isCrashed?.()) return
    const presented = this.isPresented(pane.kind)
    if (pane.kind === 'desktop') return
    if (pane.kind === 'mobile' && !this.applyMobileEmulation && presented) return
    if (presented && !pane.attachedVisible) return
    if (!presented && pane.kind !== 'mobile') return
    const pid = view.webContents.getOSProcessId?.()
    if (typeof pid === 'number' && pid <= 0) return
    const visual = presented ? this.slotFor(pane.kind) : hiddenPresetBounds(pane.kind, this.mobileDevice)
    const emulation = browserDeviceEmulationFor(pane.kind, visual, this.mobileDevice)
    view.webContents.enableDeviceEmulation?.(emulation)
  }

  private applyMobileUserAgent(pane: ViewPane): void {
    if (pane.kind !== 'mobile' || !this.viewUsable(pane.view) || !this.mobileDevice.userAgent) return
    pane.view.webContents.setUserAgent?.(this.mobileDevice.userAgent)
  }

  private presentPane(pane: ViewPane, presented: boolean): void {
    const view = pane.view
    if (!this.viewUsable(view)) return
    this.attachView(pane, presented)
    const visual = presented ? this.slotFor(pane.kind) : hiddenPresetBounds(pane.kind, this.mobileDevice)
    setNativeBounds(view, visual)
    // Detached WebContentsView has no RenderWidgetHostView; EnableDeviceEmulation SIGSEGVs.
    applyViewport(view, pane.kind, visual, presented, this.mobileDevice)
    view.setVisible?.(presented)
    this.applyMobileUserAgent(pane)
    traceBrowserNative(presented ? 'bounds:visible' : 'bounds:hidden', view, undefined, { requested: this.bounds, viewport: pane.kind })
  }

  private viewUsable(view: BrowserViewLike | undefined): view is BrowserViewLike {
    return nativeViewUsable(view)
  }

  private resetPane(pane: ViewPane, close: boolean): void {
    const view = pane.view
    if (!view) {
      pane.shownTabId = undefined
      pane.loadedUrl = undefined
      pane.attachedVisible = undefined
      pane.pending = undefined
      return
    }
    const contents = this.beginViewRetirement(pane, view)
    if (close && contents && !contents.isDestroyed?.()) contents.close?.()
  }

  private ensurePane(kind: BrowserViewportKind): ViewPane {
    const pane = this.panes[kind]
    if (this.viewUsable(pane.view)) return pane
    if (pane.view) this.beginViewRetirement(pane, pane.view)
    pane.shownTabId = undefined
    pane.loadedUrl = undefined
    pane.attachedVisible = undefined
    pane.pending = undefined
    if (!this.attach) throw new Error('browser window is unavailable')
    const view = this.createView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: this.partition } })
    pane.view = view
    this.viewGeneration += 1
    this.applyMobileUserAgent(pane)
    setNativeBounds(view, hiddenPresetBounds(kind, this.mobileDevice))
    view.setVisible?.(false)
    this.hookConsole(view.webContents)
    if (shouldOpenBrowserDevTools() && !view.webContents.isDevToolsOpened?.()) {
      view.webContents.openDevTools?.({ mode: 'detach' })
    }
    view.webContents.on('destroyed', () => {
      if (pane.view !== view) return
      this.beginViewRetirement(pane, view)
    })
    view.webContents.on('did-start-loading', () => {
      if (pane.view !== view) return
      this.setLoading(pane, true)
    })
    view.webContents.on('did-stop-loading', () => {
      if (pane.view !== view) return
      this.setLoading(pane, false)
      this.applyDeviceEmulationIfSafe(pane)
    })
    view.webContents.on('did-fail-load', (_event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
      if (pane.view !== view) return
      if (!isMainFrame || errorCode === -3) return
      this.pendingDocumentOwnerTabId = undefined
      this.failedLoadViews.add(view)
      this.setLoading(pane, false)
      const target = validatedURL || this.active?.url || ''
      this.emitError(`${errorDescription || 'load failed'} (${errorCode})${target ? ` ${target}` : ''}`)
    })
    view.webContents.on('render-process-gone', () => {
      if (pane.view !== view) return
      this.setLoading(pane, false)
      this.retireView(pane, view)
      this.emitError('浏览器渲染进程已崩溃，将在下次打开时重建')
    })
    view.webContents.on('did-navigate', (_event: unknown, url: string) => {
      if (pane.view !== view) return
      this.commitDocumentOwner()
      this.didNavigate(pane, url)
    })
    view.webContents.on('did-navigate-in-page', (_event: unknown, url: string) => {
      if (pane.view !== view) return
      this.didNavigate(pane, url)
    })
    view.webContents.on('page-title-updated', (_event: unknown, title: string) => {
      if (pane.view !== view) return
      this.didUpdateTitle(pane, title)
    })
    return pane
  }

  /** Remove one failed native surface from all ownership before replacement. */
  private retireView(pane: ViewPane, view: BrowserViewLike): void {
    const contents = this.beginViewRetirement(pane, view)
    if (contents && !contents.isDestroyed?.()) contents.close?.()
  }

  /** Start retirement once, retaining webContents for ordered cleanup/close. */
  private hookConsole(contents: BrowserWebContentsLike): void {
    if (this.consoles.isHooked(contents) || this.consoleListeners.has(contents)) return
    const listener = (...args: any[]) => {
      const tabId = this.documentOwnerTabId
      if (!tabId) return
      const first = args[0]
      const details = first && typeof first === 'object' && ('message' in first || 'level' in first) ? first : undefined
      const levelRaw = details?.level ?? args[1]
      const messageRaw = details?.message ?? args[2]
      const lineRaw = details?.lineNumber ?? details?.line ?? args[3]
      const sourceRaw = details?.sourceId ?? args[4]
      const level = typeof levelRaw === 'number'
        ? (levelRaw >= 3 ? 'error' : levelRaw === 2 ? 'warn' : levelRaw === 1 ? 'info' : 'log')
        : String(levelRaw || 'log')
      this.consoles.push({
        timestamp: Date.now(),
        level,
        message: String(messageRaw ?? ''),
        sourceId: sourceRaw != null ? String(sourceRaw) : undefined,
        line: typeof lineRaw === 'number' ? lineRaw : undefined,
        url: contents.getURL?.() || this.primaryPaneIfCreated()?.loadedUrl,
        tabId,
      })
    }
    this.consoleListeners.set(contents, listener)
    contents.on('console-message', listener)
    this.consoles.markHooked(contents)
  }

  private unhookConsole(contents?: BrowserWebContentsLike): void {
    if (!contents) return
    const listener = this.consoleListeners.get(contents)
    if (listener) {
      contents.off?.('console-message', listener)
      this.consoleListeners.delete(contents)
    }
  }

  private beginViewRetirement(pane: ViewPane, view: BrowserViewLike): BrowserWebContentsLike | undefined {
    if (pane.view === view) {
      this.unhookConsole(view.webContents)
      pane.view = undefined
      pane.shownTabId = undefined
      pane.loadedUrl = undefined
      pane.attachedVisible = undefined
      pane.pending = undefined
      this.viewGeneration += 1
      if (this.createdPanes().length === 0) this.resetDocumentOwnership()
    }
    if (this.retiredViews.has(view)) return undefined
    this.retiredViews.add(view)
    if (nativeViewUsable(view)) {
      setNativeBounds(view, hiddenBounds)
      view.setVisible?.(false)
    } else {
      view.setVisible?.(false)
    }
    try {
      this.attach?.(view, 'detach', pane.kind, this.mobileWindowDevice())
    } finally {
      view.webContents?.stop?.()
    }
    return view.webContents
  }

  private attachView(pane: ViewPane, visible: boolean): void {
    if (!this.viewUsable(pane.view)) return
    if (pane.attachedVisible === visible) return
    const attachedBounds = this.attach?.(pane.view, visible, pane.kind, this.mobileWindowDevice())
    if (pane.kind === 'mobile' && attachedBounds && attachedBounds.width > 0 && attachedBounds.height > 0) {
      this.mobileWindowViewport = {
        x: 0,
        y: 0,
        width: roundRect(attachedBounds.width),
        height: roundRect(attachedBounds.height),
        visible
      }
    }
    pane.attachedVisible = visible
  }

  private mobileWindowDevice(): BrowserMobileWindowDevice {
    const preset = browserMobileDeviceById(this.mobileDeviceId)
    return { ...this.mobileDevice, deviceId: this.mobileDeviceId, label: preset.label }
  }

  private async requestReveal(): Promise<void> {
    if (this.isVisible()) return
    this.listeners.forEach(listener => listener({ type: 'reveal' }))
    if (this.isVisible()) return
    await new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        this.revealWaiters.delete(finish)
        resolve()
      }
      this.revealWaiters.add(finish)
      setTimeout(finish, 300)
    })
  }

  private panesForShow(): ViewPane[] {
    this.ensurePanesForMode()
    const primary = this.ensurePane(this.primaryKind())
    return [primary, ...this.createdPanes().filter(pane => pane.kind !== primary.kind)]
  }

  private async show(tab: BrowserTabRecord, kind: NavigationKind, allowHidden = false): Promise<void> {
    if (!this.isVisible() && !allowHidden) await this.requestReveal()
    const panes = this.panesForShow()
    await Promise.all(panes.map(pane => this.showPane(pane, tab, kind, allowHidden)))
  }

  private async showPane(pane: ViewPane, tab: BrowserTabRecord, kind: NavigationKind, _allowHidden = false): Promise<void> {
    const presented = this.isPresented(pane.kind)
    const view = this.ensurePane(pane.kind).view
    if (!view) throw new Error('browser window is unavailable')
    this.presentPane(pane, presented)
    const visual = presented ? this.slotFor(pane.kind) : hiddenPresetBounds(pane.kind)
    traceBrowserNative('show:prepared', view, undefined, { visible: presented, requested: visual, viewport: pane.kind })
    const url = (tab.history[tab.historyIndex] ?? tab.url) || 'about:blank'
    if (kind === 'restore' && this.canReuseShownPage(pane, tab, view, url)) {
      pane.shownTabId = tab.id
      this.documentOwnerTabId = tab.id
      this.pendingDocumentOwnerTabId = undefined
      return
    }
    pane.shownTabId = tab.id
    this.pendingDocumentOwnerTabId = tab.id
    this.navigationGeneration += 1
    pane.pending = { tabId: tab.id, kind, url }
    tab.isLoading = true
    this.emit()
    try {
      await Promise.resolve(view.webContents.loadURL(url))
      pane.loadedUrl = url
    } catch (error) {
      if (pane.pending?.tabId === tab.id) pane.pending = undefined
      if (this.pendingDocumentOwnerTabId === tab.id) this.pendingDocumentOwnerTabId = undefined
      tab.isLoading = false
      this.emit()
      const message = error instanceof Error ? error.message : String(error)
      this.emitError(message)
      if (pane.view === view && this.failedLoadViews.has(view) && message.includes('ERR_FAILED')) {
        this.retireView(pane, view)
        const retry = this.ensurePane(pane.kind)
        if (!retry.view) throw error
        this.presentPane(retry, presented)
        retry.shownTabId = tab.id
        this.pendingDocumentOwnerTabId = tab.id
        retry.pending = { tabId: tab.id, kind, url }
        tab.isLoading = true
        this.emit()
        try {
          await Promise.resolve(retry.view.webContents.loadURL(url))
          retry.loadedUrl = url
        } catch (retryError) {
          if (retry.pending?.tabId === tab.id) retry.pending = undefined
          if (this.pendingDocumentOwnerTabId === tab.id) this.pendingDocumentOwnerTabId = undefined
          tab.isLoading = false
          this.emit()
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
          this.emitError(retryMessage)
          if (retry.view && this.failedLoadViews.has(retry.view)) this.retireView(retry, retry.view)
          throw retryError
        }
        return
      }
      throw error
    }
  }

  private canReuseShownPage(pane: ViewPane, tab: BrowserTabRecord, view: BrowserViewLike, url: string): boolean {
    if (pane.shownTabId !== tab.id || !this.viewUsable(view)) return false
    const current = view.webContents.getURL?.() || pane.loadedUrl
    return Boolean(current) && current === url
  }

  private resetDocumentOwnership(): void {
    this.documentOwnerTabId = undefined
    this.pendingDocumentOwnerTabId = undefined
  }

  private commitDocumentOwner(): void {
    if (!this.pendingDocumentOwnerTabId) return
    this.documentOwnerTabId = this.pendingDocumentOwnerTabId
    this.pendingDocumentOwnerTabId = undefined
  }

  private navigationTab(pane: ViewPane): BrowserTabRecord | undefined {
    return pane.pending ? this.tabs.find(tab => tab.id === pane.pending!.tabId) : this.active
  }

  private setLoading(pane: ViewPane, isLoading: boolean): void {
    const tab = this.navigationTab(pane)
    if (!tab) return
    tab.isLoading = isLoading
    if (!isLoading) pane.pending = undefined
    this.emit()
  }

  private didNavigate(pane: ViewPane, url: string): void {
    pane.loadedUrl = url
    const tab = this.navigationTab(pane)
    if (!tab) return
    const pending = pane.pending
    if (pending?.kind === 'push') {
      if (tab.historyIndex >= 0) tab.history[tab.historyIndex] = url
      else this.pushHistory(tab, url)
    } else if (pending?.kind === 'history') {
      tab.history[tab.historyIndex] = url
    } else if (!pending || pending.kind === 'reload') {
      this.pushHistory(tab, url)
    } else if (pending.kind === 'restore' && tab.url) {
      tab.url = url
      if (tab.historyIndex >= 0) tab.history[tab.historyIndex] = url
    }
    if (url !== 'about:blank' || tab.url) {
      tab.url = url
      if (!tab.title || tab.title === '新标签页') tab.title = tabTitle(url)
    }
    this.syncNavigationButtons(tab)
    this.emit()
    if (!pending) this.syncSiblingPane(pane, tab, url)
  }

  private syncSiblingPane(source: ViewPane, tab: BrowserTabRecord, url: string): void {
    for (const pane of this.createdPanes()) {
      if (pane.kind === source.kind || !pane.view) continue
      const current = pane.view.webContents.getURL?.() || pane.loadedUrl
      if (current === url) continue
      pane.pending = { tabId: tab.id, kind: 'restore', url }
      void Promise.resolve(pane.view.webContents.loadURL(url)).then(() => {
        pane.loadedUrl = url
        pane.shownTabId = tab.id
      }).catch(error => {
        this.emitError(error instanceof Error ? error.message : String(error))
      })
    }
  }

  private reloadMobileForDeviceChange(): void {
    const pane = this.panes.mobile
    if (!this.viewUsable(pane.view)) return
    this.applyMobileUserAgent(pane)
    const url = pane.loadedUrl || this.active?.url
    if (!url || url === 'about:blank') return
    pane.pending = { tabId: this.active?.id ?? pane.shownTabId ?? '', kind: 'reload', url }
    pane.view.webContents.reload()
  }

  private didUpdateTitle(pane: ViewPane, title: string): void {
    const tab = this.navigationTab(pane)
    if (!tab || !title.trim()) return
    tab.title = title.trim()
    this.emit()
  }

  private emit(): void {
    const event: BrowserSpaceEvent = { type: 'tabs', snapshot: this.state() }
    this.listeners.forEach(listener => listener(event))
  }

  private emitError(message: string): void {
    const event: BrowserSpaceEvent = { type: 'error', message }
    this.listeners.forEach(listener => listener(event))
  }
}

type BrowserSessionRecord = {
  host: BrowserTabsHost
  unsubscribe: Unsubscribe
  tail: Promise<void>
  disposing: boolean
}

/**
 * One browser space per authenticated Pi session. Each record owns up to two
 * physical WebContentsViews (desktop + mobile child window), one Chromium
 * storage partition, virtual tabs, and an operation queue. Queues are
 * independent, so background sessions never block each other.
 */
export class BrowserSessionHost implements BrowserHostAPI {
  private readonly records = new Map<string, BrowserSessionRecord>()
  private readonly listeners = new Set<(event: BrowserEvent) => void>()
  private attach?: BrowserSessionViewAttach
  private selectedSessionId?: string
  private visibleSessionId?: string

  constructor(private readonly createView: BrowserViewFactory) {}

  attachToWindow(attach: BrowserSessionViewAttach): void {
    this.attach = attach
    for (const [sessionId, record] of this.records) {
      record.host.attachToWindow((view, placement, kind, device) => attach(sessionId, view, placement, kind, device))
    }
  }

  detachWindow(): void {
    for (const record of this.records.values()) record.host.detachWindow()
    this.attach = undefined
    this.visibleSessionId = undefined
  }

  async selectSession(sessionId: string): Promise<void> {
    this.selectedSessionId = sessionId
  }

  listTabs(sessionId: string): Promise<BrowserTabsSnapshot> { return this.run(sessionId, host => host.listTabs()) }
  getActiveTab(sessionId: string): Promise<BrowserTab | undefined> { return this.run(sessionId, host => host.getActiveTab()) }
  newTab(sessionId: string, options?: BrowserTabOptions): Promise<BrowserTab> { return this.run(sessionId, host => host.newTab(options)) }
  switchTab(sessionId: string, tabId: string): Promise<BrowserTab> { return this.run(sessionId, host => host.switchTab(tabId)) }
  closeTab(sessionId: string, tabId: string): Promise<BrowserTabsSnapshot> { return this.run(sessionId, host => host.closeTab(tabId)) }
  loadURL(sessionId: string, url: string, tabId?: string): Promise<BrowserTab> { return this.run(sessionId, host => host.loadURL(url, tabId)) }
  goBack(sessionId: string, tabId?: string): Promise<BrowserTab> { return this.run(sessionId, host => host.goBack(tabId)) }
  goForward(sessionId: string, tabId?: string): Promise<BrowserTab> { return this.run(sessionId, host => host.goForward(tabId)) }
  reload(sessionId: string, tabId?: string): Promise<BrowserTab> { return this.run(sessionId, host => host.reload(tabId)) }
  snapshot(sessionId: string, tabId?: string): Promise<BrowserSnapshot> { return this.run(sessionId, host => host.snapshot(tabId)) }

  async setViewBounds(sessionId: string, bounds: BrowserViewBounds): Promise<void> {
    const id = sessionId.trim()
    const record = this.record(sessionId)
    const visible = bounds.visible !== false && bounds.width > 0 && bounds.height > 0
    const prior = this.visibleSessionId
    if (visible && prior && prior !== id) {
      const old = this.records.get(prior)
      if (old && !old.disposing) await old.host.setViewBounds(hiddenBounds, false)
      if (!this.recordIsCurrent(id, record)) return
    }
    const needsRestore = await record.host.setViewBounds(bounds, false)
    if (!this.recordIsCurrent(id, record)) return
    if (visible) this.visibleSessionId = id
    else if (this.visibleSessionId === id) this.visibleSessionId = undefined
    if (needsRestore) void this.enqueue(record, () => record.host.restoreVisiblePage()).catch(() => undefined)
  }

  mobileWindowResized(sessionId: string, size: { width: number; height: number }): void {
    const record = this.records.get(sessionId)
    if (!record || record.disposing) return
    record.host.mobileWindowResized(size)
  }

  mobileWindowClosed(sessionId: string): void {
    const record = this.records.get(sessionId)
    if (!record || record.disposing) return
    record.host.mobileWindowClosed()
  }

  toolAction(sessionId: string, request: BrowserToolRequest): Promise<BrowserToolResult> {
    return this.run(sessionId, host => host.toolAction(request, { reveal: sessionId === this.selectedSessionId }))
  }

  subscribe(listener: (event: BrowserEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async disposeSession(sessionId: string): Promise<void> {
    const record = this.records.get(sessionId)
    if (!record || record.disposing) return
    record.disposing = true
    record.unsubscribe()
    if (this.visibleSessionId === sessionId) this.visibleSessionId = undefined
    if (this.selectedSessionId === sessionId) this.selectedSessionId = undefined
    await this.enqueue(record, () => record.host.dispose(true))
    this.records.delete(sessionId)
  }

  private record(sessionId: string): BrowserSessionRecord {
    const id = sessionId.trim()
    if (!id) throw new Error('browser sessionId is required')
    const current = this.records.get(id)
    if (current) {
      if (current.disposing) throw new Error(`browser session is disposing: ${id}`)
      return current
    }
    const host = new BrowserTabsHost(this.createView, browserPartitionForSession(id))
    if (this.attach) host.attachToWindow((view, placement, kind, device) => this.attach?.(id, view, placement, kind, device))
    const record = { host, tail: Promise.resolve(), disposing: false, unsubscribe: () => undefined }
    record.unsubscribe = host.subscribe(event => {
      if (event.type === 'reveal' && id !== this.selectedSessionId) return
      const scoped = { ...event, sessionId: id } as BrowserEvent
      this.listeners.forEach(listener => listener(scoped))
    })
    this.records.set(id, record)
    return record
  }

  private recordIsCurrent(sessionId: string, record: BrowserSessionRecord): boolean {
    return !record.disposing && this.records.get(sessionId) === record
  }

  private run<T>(sessionId: string, operation: (host: BrowserTabsHost) => Promise<T>): Promise<T> {
    const record = this.record(sessionId)
    return this.enqueue(record, () => operation(record.host))
  }

  private enqueue<T>(record: BrowserSessionRecord, operation: () => Promise<T>): Promise<T> {
    const result = record.tail.then(operation)
    record.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Adds the Electron-only browser extension without changing the Pi backend. */
export function withBrowserTabsHost(backend: HostBackend, browser: BrowserSessionHost): HostBackend {
  const listeners = new Set<(event: HostEvent) => void>()
  browser.subscribe(event => {
    const frame: HostEvent = { protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'browser', event }
    listeners.forEach(listener => listener(frame))
  })

  return {
    async handle(method: HostMethod, params: unknown[]): Promise<unknown> {
      switch (method) {
        case 'browserSelectSession': return browser.selectSession(params[0] as string)
        case 'browserListTabs': return browser.listTabs(params[0] as string)
        case 'browserGetActiveTab': return browser.getActiveTab(params[0] as string)
        case 'browserNewTab': return browser.newTab(params[0] as string, params[1] as BrowserTabOptions | undefined)
        case 'browserSwitchTab': return browser.switchTab(params[0] as string, params[1] as string)
        case 'browserCloseTab': return browser.closeTab(params[0] as string, params[1] as string)
        case 'browserLoadURL': return browser.loadURL(params[0] as string, params[1] as string, params[2] as string | undefined)
        case 'browserGoBack': return browser.goBack(params[0] as string, params[1] as string | undefined)
        case 'browserGoForward': return browser.goForward(params[0] as string, params[1] as string | undefined)
        case 'browserReload': return browser.reload(params[0] as string, params[1] as string | undefined)
        case 'browserSnapshot': return browser.snapshot(params[0] as string, params[1] as string | undefined)
        case 'browserSetViewBounds': return browser.setViewBounds(params[0] as string, params[1] as BrowserViewBounds)
        case 'deleteSession': {
          const result = await backend.handle(method, params)
          await browser.disposeSession(params[0] as string)
          return result
        }
        case 'capabilities': {
          const current = await backend.handle(method, params)
          return { ...(current && typeof current === 'object' ? current as Record<string, unknown> : {}), browser: true }
        }
        default:
          return backend.handle(method, params)
      }
    },
    subscribe(listener: (event: HostEvent) => void): Unsubscribe {
      listeners.add(listener)
      const unsubscribe = backend.subscribe(listener)
      return () => {
        listeners.delete(listener)
        unsubscribe()
      }
    }
  }
}
