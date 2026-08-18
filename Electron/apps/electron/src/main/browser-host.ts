import {
  PIPI_HOST_PROTOCOL_VERSION,
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
  session?: { clearStorageData(): Promise<void>; clearCache(): Promise<void> }
  on(event: string, listener: (...args: any[]) => void): unknown
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
type BrowserViewPlacement = boolean | 'detach'
type BrowserViewAttach = (view: BrowserViewLike, placement: BrowserViewPlacement) => void
type BrowserSpaceEvent =
  | { type: 'tabs'; snapshot: BrowserTabsSnapshot }
  | { type: 'reveal' }
  | { type: 'error'; message: string }

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

export function routeBrowserView(
  view: BrowserViewLike,
  placement: BrowserViewPlacement,
  mainHost: BrowserViewNativeHostLike,
  hiddenHost?: BrowserViewNativeHostLike
): void {
  const parent = browserViewParent.get(view)
  if (placement === 'detach') {
    try { mainHost.contentView.removeChildView(view) } catch { /* not attached */ }
    try { hiddenHost?.contentView.removeChildView(view) } catch { /* not attached */ }
    browserViewParent.delete(view)
    view.setVisible?.(false)
    traceBrowserNative('route:detach', view, mainHost)
    return
  }
  const visible = placement
  // A WebContentsView has one stable native owner for its whole lifetime.
  // Electron documents same-parent add as a reorder operation, but does not
  // guarantee that a live Chromium surface can migrate across BaseWindows.
  // Hidden tool browsing therefore stays attached to main with a real viewport
  // and setVisible(false), instead of moving through the transparent host.
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
// Preserve a real Chromium layout viewport for tool-only browsing. The View
// stays hidden; moving a child View outside its parent clips it back to 0x0.
const toolHiddenBounds: BrowserViewBounds = { x: 0, y: 0, width: 1280, height: 800, visible: false }
const defaultPartition = 'persist:pipiui-browser'

function setNativeBounds(view: BrowserViewLike, bounds: BrowserViewBounds): void {
  // BrowserViewBounds carries API presentation state; Electron View.setBounds
  // accepts only a native Rectangle. Never leak the custom `visible` key into
  // gin's Rectangle conversion.
  view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })
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

/**
 * A virtual multi-tab model backed by exactly one physical WebContentsView.
 * Switching tabs reloads that tab's retained URL/history into the same view;
 * it intentionally never creates a view per tab.
 */
export class BrowserTabsHost {
  private readonly tabs: BrowserTabRecord[] = []
  private readonly listeners = new Set<(event: BrowserSpaceEvent) => void>()
  private readonly revealWaiters = new Set<() => void>()
  private readonly failedLoadViews = new WeakSet<BrowserViewLike>()
  private readonly retiredViews = new WeakSet<BrowserViewLike>()
  private view?: BrowserViewLike
  private attach?: BrowserViewAttach
  private attachedVisible?: boolean
  private activeTabId?: string
  private shownTabId?: string
  private loadedUrl?: string
  private pending?: PendingNavigation
  private toolRevealPending = false
  private toolNavigationPending = false
  private bounds: BrowserViewBounds = hiddenBounds
  private sequence = 0

  constructor(private readonly createView: BrowserViewFactory, private readonly partition = defaultPartition) {
    this.createTab()
  }

  /** A later BrowserWindow can become the sole owner after the prior one closes. */
  attachToWindow(attach: BrowserViewAttach): void {
    this.view?.setVisible?.(false)
    this.view = undefined
    this.shownTabId = undefined
    this.loadedUrl = undefined
    this.attach = attach
    this.attachedVisible = undefined
  }

  detachWindow(): void {
    this.view?.setVisible?.(false)
    this.view?.webContents.stop?.()
    if (!this.view?.webContents.isDestroyed?.()) this.view?.webContents.close?.()
    this.view = undefined
    this.shownTabId = undefined
    this.loadedUrl = undefined
    this.attach = undefined
    this.attachedVisible = undefined
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
    if (wasActive) this.view?.webContents.stop?.()
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
    if (!this.isVisible() || !this.view) return copyTab(tab)
    tab.isLoading = true
    this.pending = { tabId: tab.id, kind: 'reload', url: tab.url || 'about:blank' }
    this.emit()
    this.view.webContents.reload()
    return copyTab(tab)
  }

  async snapshot(tabId?: string): Promise<BrowserSnapshot> {
    const tab = this.tabFor(tabId)
    const snapshot: BrowserSnapshot = { tabId: tab.id, url: tab.url, title: tab.title, isLoading: tab.isLoading }
    const evaluate = this.view?.webContents.executeJavaScript
    if (tab.id !== this.activeTabId || tab.id !== this.shownTabId || !evaluate) return snapshot
    try {
      const text = await evaluate.call(this.view!.webContents, 'document.body?.innerText ?? ""')
      if (typeof text === 'string') snapshot.text = text
    } catch {
      // Navigation races and restricted pages can reject evaluation; metadata
      // remains useful and matches the pre-text snapshot contract.
    }
    return snapshot
  }

  async toolAction(request: BrowserToolRequest, options: { reveal?: boolean } = {}): Promise<BrowserToolResult> {
    try {
      if (options.reveal !== false) await this.revealForTool()
      if (request.action === 'navigate') {
        if (!request.url) return { ok: false, error: 'browser navigate requires url' }
        await this.loadURLForTool(request.url)
        return this.domAction({ action: 'observe', scope: request.scope ?? 'viewport' })
      }
      if (request.action === 'back') { await this.goBack(); if (this.active) await this.show(this.active, 'history', true); return this.domAction({ action: 'observe', scope: request.scope ?? 'viewport' }) }
      if (request.action === 'forward') { await this.goForward(); if (this.active) await this.show(this.active, 'history', true); return this.domAction({ action: 'observe', scope: request.scope ?? 'viewport' }) }
      if (request.action === 'reload') { if (this.active) await this.show(this.active, 'reload', true); return this.domAction({ action: 'observe', scope: request.scope ?? 'viewport' }) }
      if (request.action === 'screenshot') {
        await this.ensureToolPage()
        const image = await this.view?.webContents.capturePage?.(undefined, { stayHidden: !this.isVisible() })
        if (!image) return { ok: false, error: 'browser screenshot is unavailable' }
        const bytes = Buffer.from(image.toPNG())
        if (bytes.length === 0) return { ok: false, error: 'browser screenshot is empty' }
        return { ok: true, base64: bytes.toString('base64'), mimeType: 'image/png' }
      }
      if (request.action === 'type') {
        if (request.selector) return this.selectorAction({ ...request, action: 'input', mode: 'append' })
        return this.domAction({ ...request, action: 'input', text: request.text ?? '' })
      }
      if (request.selector && (request.action === 'click' || request.action === 'input')) {
        return this.selectorAction(request)
      }
      // eval/content run against the live page directly; the structured DOM
      // controller only models observe/click/input/select/scroll, so routing
      // these through domAction would surface "unsupported browser action".
      if (request.action === 'eval') return this.evalAction(request)
      if (request.action === 'content') return this.contentAction(request)
      if (['observe', 'click', 'input', 'select', 'scroll'].includes(request.action)) return this.domAction(request)
      return { ok: false, error: `unknown browser action: ${request.action}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async evalAction(request: BrowserToolRequest): Promise<BrowserToolResult> {
    await this.ensureToolPage()
    const execute = this.view?.webContents.executeJavaScript
    if (!execute || !this.active || this.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    if (typeof request.js !== 'string' || request.js.length === 0) return { ok: false, error: 'browser eval requires js' }
    try {
      const result = await execute.call(this.view.webContents, request.js)
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async contentAction(request: BrowserToolRequest): Promise<BrowserToolResult> {
    await this.ensureToolPage()
    const execute = this.view?.webContents.executeJavaScript
    if (!execute || !this.active || this.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    const htmlMode = request.mode === 'html'
    // Read-only page dump composed as a static script; the mode flag is the
    // only interpolated value and it is a validated boolean.
    const source = `(() => { const html = ${JSON.stringify(htmlMode)}; return { title: document.title, url: location.href, content: html ? document.documentElement.outerHTML : (document.body ? document.body.innerText : "") }; })()`
    try {
      const raw = await execute.call(this.view.webContents, source) as { content?: unknown } | undefined
      const full = typeof raw?.content === 'string' ? raw.content : ''
      const truncated = full.length > 100_000
      return { ok: true, content: truncated ? full.slice(0, 100_000) : full, truncated }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async domAction(request: Record<string, unknown>): Promise<BrowserToolResult> {
    await this.ensureToolPage()
    const execute = this.view?.webContents.executeJavaScript
    if (!execute || !this.active || this.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    const source = `if(!globalThis.__pipiBrowserDOM){${browserDOMControllerSource}}\n;globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify(request)})`
    const result = await execute.call(this.view.webContents, source)
    return result && typeof result === 'object' ? result as BrowserToolResult : { ok: false, error: 'browser action returned no result' }
  }

  private async ensureToolPage(): Promise<void> {
    const tab = this.active ?? this.createTab()
    if (!this.view || this.shownTabId !== tab.id) await this.show(tab, 'restore', true)
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

  private async selectorAction(request: BrowserToolRequest): Promise<BrowserToolResult> {
    const execute = this.view?.webContents.executeJavaScript
    if (!execute) return { ok: false, error: 'browser page is unavailable' }
    const selector = JSON.stringify(request.selector)
    const text = JSON.stringify(request.text ?? '')
    const append = request.action === 'input' && request.mode === 'append'
    const code = `(()=>{const e=document.querySelector(${selector});if(!e)return {ok:false,error:'selector not found'};if(${JSON.stringify(request.action)}==='click'){e.click();return {ok:true}};const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;p?p.call(e,${append ? `String(e.value??'')+${text}` : text}):e.value=${text};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()`
    const result = await execute.call(this.view.webContents, code)
    if (!result || typeof result !== 'object' || !(result as any).ok) return result as BrowserToolResult
    return this.domAction({ action: 'observe', scope: request.scope ?? 'viewport' })
  }

  async setViewBounds(bounds: BrowserViewBounds, restoreActivePage = true): Promise<boolean> {
    this.bounds = {
      x: Math.max(0, Math.round(Number.isFinite(bounds.x) ? bounds.x : 0)),
      y: Math.max(0, Math.round(Number.isFinite(bounds.y) ? bounds.y : 0)),
      width: Math.max(0, Math.round(Number.isFinite(bounds.width) ? bounds.width : 0)),
      height: Math.max(0, Math.round(Number.isFinite(bounds.height) ? bounds.height : 0)),
      visible: bounds.visible !== false
    }
    if (!this.isVisible()) {
      if (this.view) this.attachView(this.view, false)
      // Keep a real layout viewport so Chromium does not discard the compositor
      // surface. The page stays on shownTabId; coming back must not loadURL.
      if (this.view) setNativeBounds(this.view, toolHiddenBounds)
      this.view?.setVisible?.(false)
      if (this.view) traceBrowserNative('bounds:hidden', this.view, undefined, { requested: this.bounds })
      return false
    }
    const view = this.ensureView()
    this.attachView(view, true)
    setNativeBounds(view, this.bounds)
    view.setVisible?.(true)
    traceBrowserNative('bounds:visible', view, undefined, { requested: this.bounds })
    this.revealWaiters.forEach(resolve => resolve())
    this.revealWaiters.clear()
    const activeHasPage = Boolean(this.active && (this.active.history.length > 0 || this.active.url))
    const needsRestore = !this.toolRevealPending && !this.toolNavigationPending && activeHasPage && this.active && this.shownTabId !== this.active.id
    if (restoreActivePage && needsRestore) void this.restoreVisiblePage()
    return Boolean(needsRestore)
  }

  async restoreVisiblePage(): Promise<void> {
    const active = this.active
    if (!this.isVisible() || this.toolRevealPending || this.toolNavigationPending || !active) return
    if ((!active.history.length && !active.url) || this.shownTabId === active.id) return
    await this.show(active, 'restore')
  }

  subscribe(listener: (event: BrowserSpaceEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Session deletion is terminal: destroy its page and erase that partition's browsing data. */
  async dispose(clearStorage = false): Promise<void> {
    const view = this.view
    this.bounds = hiddenBounds
    this.revealWaiters.forEach(resolve => resolve())
    this.revealWaiters.clear()
    const contents = view ? this.beginViewRetirement(view) : undefined
    this.view = undefined
    this.shownTabId = undefined
    this.loadedUrl = undefined
    this.attach = undefined
    this.attachedVisible = undefined
    if (!contents) return
    if (clearStorage && contents.session) {
      await Promise.allSettled([
        contents.session.clearStorageData(),
        contents.session.clearCache()
      ])
    }
    if (!contents.isDestroyed?.()) contents.close?.()
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

  private viewUsable(view: BrowserViewLike | undefined): view is BrowserViewLike {
    const contents = view?.webContents
    return Boolean(contents && typeof contents.loadURL === 'function' && !contents.isDestroyed?.())
  }

  private ensureView(): BrowserViewLike {
    if (this.viewUsable(this.view)) return this.view
    // A closed/crashed WebContentsView keeps the wrapper but drops `webContents`.
    // Reuse would throw `Cannot read properties of undefined (reading 'loadURL')`
    // and leave the curator tab stuck on a hostname-only "localhost" chrome.
    this.view = undefined
    this.shownTabId = undefined
    this.loadedUrl = undefined
    this.attachedVisible = undefined
    if (!this.attach) throw new Error('browser window is unavailable')
    // This is the only `new WebContentsView` path; virtual tabs reuse it.
    const view = this.createView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: this.partition } })
    this.view = view
    setNativeBounds(view, hiddenBounds)
    view.setVisible?.(false)
    view.webContents.on('did-start-loading', () => {
      if (this.view !== view) return
      this.setLoading(true)
    })
    view.webContents.on('did-stop-loading', () => {
      if (this.view !== view) return
      this.setLoading(false)
    })
    view.webContents.on('did-fail-load', (_event: unknown, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
      if (this.view !== view) return
      if (!isMainFrame || errorCode === -3) return
      this.failedLoadViews.add(view)
      this.setLoading(false)
      const target = validatedURL || this.active?.url || ''
      this.emitError(`${errorDescription || 'load failed'} (${errorCode})${target ? ` ${target}` : ''}`)
    })
    view.webContents.on('render-process-gone', () => {
      if (this.view !== view) return
      this.setLoading(false)
      this.retireView(view)
      this.emitError('浏览器渲染进程已崩溃，将在下次打开时重建')
    })
    view.webContents.on('did-navigate', (_event: unknown, url: string) => {
      if (this.view !== view) return
      this.didNavigate(url)
    })
    view.webContents.on('did-navigate-in-page', (_event: unknown, url: string) => {
      if (this.view !== view) return
      this.didNavigate(url)
    })
    view.webContents.on('page-title-updated', (_event: unknown, title: string) => {
      if (this.view !== view) return
      this.didUpdateTitle(title)
    })
    return view
  }

  /** Remove one failed native surface from all ownership before replacement. */
  private retireView(view: BrowserViewLike): void {
    const contents = this.beginViewRetirement(view)
    if (contents && !contents.isDestroyed?.()) contents.close?.()
  }

  /** Start retirement once, retaining webContents for ordered cleanup/close. */
  private beginViewRetirement(view: BrowserViewLike): BrowserWebContentsLike | undefined {
    if (this.view === view) {
      this.view = undefined
      this.shownTabId = undefined
      this.loadedUrl = undefined
      this.attachedVisible = undefined
    }
    if (this.retiredViews.has(view)) return undefined
    this.retiredViews.add(view)
    setNativeBounds(view, hiddenBounds)
    view.setVisible?.(false)
    try {
      this.attach?.(view, 'detach')
    } finally {
      view.webContents.stop?.()
    }
    return view.webContents
  }

  private attachView(view: BrowserViewLike, visible: boolean): void {
    if (this.attachedVisible === visible) return
    this.attach?.(view, visible)
    this.attachedVisible = visible
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

  private async show(tab: BrowserTabRecord, kind: NavigationKind, allowHidden = false): Promise<void> {
    if (!this.isVisible() && !allowHidden) await this.requestReveal()
    const visible = this.isVisible()
    const view = this.ensureView()
    this.attachView(view, visible)
    setNativeBounds(view, visible ? this.bounds : toolHiddenBounds)
    // Hidden tool pages keep a real layout viewport without painting over UI.
    view.setVisible?.(visible)
    traceBrowserNative('show:prepared', view, undefined, { visible, requested: visible ? this.bounds : toolHiddenBounds })
    const url = (tab.history[tab.historyIndex] ?? tab.url) || 'about:blank'
    if (kind === 'restore' && this.canReuseShownPage(tab, view, url)) {
      this.shownTabId = tab.id
      return
    }
    this.shownTabId = tab.id
    this.pending = { tabId: tab.id, kind, url }
    tab.isLoading = true
    this.emit()
    try {
      await Promise.resolve(view.webContents.loadURL(url))
      this.loadedUrl = url
    } catch (error) {
      if (this.pending?.tabId === tab.id) this.pending = undefined
      tab.isLoading = false
      this.emit()
      const message = error instanceof Error ? error.message : String(error)
      this.emitError(message)
      if (this.view === view && this.failedLoadViews.has(view) && message.includes('ERR_FAILED')) {
        this.retireView(view)
        const retryView = this.ensureView()
        this.attachView(retryView, visible)
        setNativeBounds(retryView, visible ? this.bounds : toolHiddenBounds)
        retryView.setVisible?.(visible)
        this.shownTabId = tab.id
        this.pending = { tabId: tab.id, kind, url }
        tab.isLoading = true
        this.emit()
        try {
          await Promise.resolve(retryView.webContents.loadURL(url))
          this.loadedUrl = url
        } catch (retryError) {
          if (this.pending?.tabId === tab.id) this.pending = undefined
          tab.isLoading = false
          this.emit()
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
          this.emitError(retryMessage)
          if (this.view === retryView && this.failedLoadViews.has(retryView)) this.retireView(retryView)
          throw retryError
        }
        return
      }
      throw error
    }
  }

  private canReuseShownPage(tab: BrowserTabRecord, view: BrowserViewLike, url: string): boolean {
    if (this.shownTabId !== tab.id || !this.viewUsable(view)) return false
    const current = view.webContents.getURL?.() || this.loadedUrl
    return Boolean(current) && current === url
  }

  private navigationTab(): BrowserTabRecord | undefined {
    return this.pending ? this.tabs.find(tab => tab.id === this.pending!.tabId) : this.active
  }

  private setLoading(isLoading: boolean): void {
    const tab = this.navigationTab()
    if (!tab) return
    tab.isLoading = isLoading
    if (!isLoading) this.pending = undefined
    this.emit()
  }

  private didNavigate(url: string): void {
    this.loadedUrl = url
    const tab = this.navigationTab()
    if (!tab) return
    const pending = this.pending
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
  }

  private didUpdateTitle(title: string): void {
    const tab = this.navigationTab()
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
 * One browser space per authenticated Pi session. Each record owns a physical
 * WebContentsView, a Chromium storage partition, virtual tabs, and an operation
 * queue. Queues are independent, so background sessions never block each other.
 */
export class BrowserSessionHost implements BrowserHostAPI {
  private readonly records = new Map<string, BrowserSessionRecord>()
  private readonly listeners = new Set<(event: BrowserEvent) => void>()
  private attach?: BrowserViewAttach
  private selectedSessionId?: string
  private visibleSessionId?: string

  constructor(private readonly createView: BrowserViewFactory) {}

  attachToWindow(attach: BrowserViewAttach): void {
    this.attach = attach
    for (const record of this.records.values()) record.host.attachToWindow(attach)
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
    if (this.attach) host.attachToWindow(this.attach)
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
