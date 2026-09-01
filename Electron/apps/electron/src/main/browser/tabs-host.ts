/**
 * BrowserTabsHost: a virtual multi-tab model backed by one physical
 * WebContentsView per viewport. It owns the tab records, pane lifecycle,
 * navigation state machine, and tool-action execution; pure layout, DOM-bridge,
 * redaction, and console helpers live in the sibling modules.
 */
import {
  browserMobileDeviceById,
  type BrowserSnapshot,
  type BrowserTab,
  type BrowserTabOptions,
  type BrowserTabsSnapshot,
  type BrowserToolRequest,
  type BrowserToolResult,
  type BrowserViewBounds,
  type Unsubscribe
} from '@pipi/host-api'
import browserDOMControllerSource from '../../../../../resources/runtime/browser-dom/controller.js?raw'
import {
  BROWSER_SCRIPT_DEADLINE_MS,
  BROWSER_SCRIPT_MAX_INPUT,
  BROWSER_WAIT_DEFAULT_IDLE_MS,
  BROWSER_WAIT_IDLE_BUDGET_SLACK_MS,
  TabConsoleBuffer,
  buildScriptWrapper,
  clampWaitTimeoutMs,
  formatConsoleLogs,
  remapScriptStack,
  requestIdOf,
  shouldOpenBrowserDevTools,
  truncateEnvelope,
  type BrowserDebugEnvelope,
} from '../browser-debug.js'
import type { WatchWaitCheckRequest } from '../watcher-registry.js'
import { createConsoleEntryListener, installJsDialogReporter, newDialogNonce } from './console-pipeline.js'
import { controllerPrelude, observePayload, requestElementToken, requestTarget, hasStructuredLocator, tagObservation, untaggedRequest } from './dom-bridge.js'
import { buildBrowserDebugEnvelope } from './debug-envelope.js'
import { awaitLoadURL, BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS, BROWSER_RELOAD_SETTLE_TIMEOUT_MS, NavigationSettle } from './navigation-settle.js'
import { nativeViewUsable, traceBrowserAction, traceBrowserNative } from './native-view.js'
import { sanitizeWithController } from './redaction.js'
import type {
  BrowserCertificateErrorAppLike,
  BrowserCertificateErrorListener,
  BrowserMobileDevice,
  BrowserMobileWindowDevice,
  BrowserSpaceEvent,
  BrowserTabRecord,
  BrowserViewAttach,
  BrowserViewFactory,
  BrowserViewLike,
  BrowserViewMode,
  BrowserViewportKind,
  BrowserWebContentsLike,
  NavigationKind,
  ViewPane,
} from './types.js'
import {
  DEFAULT_MOBILE_DEVICE,
  defaultPartition,
  hiddenBounds,
  navigationExemptActions,
  unsafeBothActions,
} from './types.js'
import { copyTab, copyTabs, normalizeBrowserURL, pushTabHistory, syncTabNavigationButtons, tabTitle } from './tab-model.js'
import {
  applyViewport,
  boundsMobileOverlay,
  boundsMode,
  boundsSlots,
  browserDeviceEmulationFor,
  browserViewportPreset,
  clampBrowserZoom,
  hiddenPresetBounds,
  mobileDeviceChanged,
  normalizeBrowserToolTarget,
  normalizeBrowserViewMode,
  parseBrowserSnapshotTarget,
  readMobileDevice,
  roundRect,
  setNativeBounds,
} from './viewport.js'

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
  /** Virtual tab that owns each pane's currently committed main-frame document. Desktop and mobile load independently, so ownership is tracked per viewport — a failed load on one pane must not erase the other pane's pending commit. */
  private readonly documentOwnerTabIds: Record<BrowserViewportKind, string | undefined> = { desktop: undefined, mobile: undefined }
  /** Tab that will own the document after each pane's in-flight main-frame commit. */
  private readonly pendingDocumentOwnerTabIds: Record<BrowserViewportKind, string | undefined> = { desktop: undefined, mobile: undefined }
  private navigationGeneration = 0
  private viewGeneration = 0
  /** Bumps on main-frame start-loading and view retirement so in-flight watch evaluates can detect a new document. */
  private documentEpoch = 0
  private readonly navigationSettle = new NavigationSettle()
  private readonly consoles = new TabConsoleBuffer()
  private readonly consoleListeners = new WeakMap<BrowserWebContentsLike, (...args: any[]) => void>
  /** Consecutive-dedupe key for the last emitted certificate notice. */
  private lastCertificateError: string | undefined
  /** App-level certificate-error source; Electron emits the event from `app`, never from webContents. */
  private readonly certificateErrorApp?: BrowserCertificateErrorAppLike
  /** Live per-commit dialog-hook nonces; a marker must carry its webContents' current nonce to count as genuine. */
  private readonly dialogNonces = new WeakMap<BrowserWebContentsLike, string>()
  private readonly handleAppCertificateError: BrowserCertificateErrorListener = (_event, webContents, url, error) => {
    const pane = this.createdPanes().find(pane => pane.view?.webContents === webContents)
    if (!pane) return
    // Observability only: without preventDefault the default reject stays in
    // force, so the tool side still sees the load fail with ERR_CERT_*.
    const target = typeof url === 'string' ? url : ''
    const reason = typeof error === 'string' && error ? error : 'certificate error'
    const key = `${reason}|${target}`
    if (this.lastCertificateError === key) return
    this.lastCertificateError = key
    this.emitNotice({ type: 'certificate-error', url: target, reason })
  }
  private readonly zoomByTab = new Map<string, number>()
  private readonly watchLifecycleListeners = new Set<(event: { type: 'destroyed' }) => void>()

  constructor(
    private readonly createView: BrowserViewFactory,
    private readonly partition = defaultPartition,
    certificateErrorApp?: BrowserCertificateErrorAppLike
  ) {
    this.createTab()
    if (!certificateErrorApp) return
    this.certificateErrorApp = certificateErrorApp
    certificateErrorApp.on('certificate-error', this.handleAppCertificateError)
  }

  /** WatcherRegistry hangs session cleanup on view retirement / destroy. */
  subscribeWatchLifecycle(listener: (event: { type: 'destroyed' }) => void): Unsubscribe {
    this.watchLifecycleListeners.add(listener)
    return () => this.watchLifecycleListeners.delete(listener)
  }

  /** Inspect the live pane without creating or revealing a WebView. */
  watchInspect(): { hasView: boolean; navigating: boolean; url: string; title: string; documentEpoch: number } {
    const pane = this.primaryPaneIfCreated()
    const tab = this.active
    const contents = pane?.view?.webContents
    const hasView = Boolean(contents && !contents.isDestroyed?.())
    const navigating = Boolean(tab?.isLoading || pane?.pending || this.toolNavigationPending)
    const url = (hasView && contents?.getURL?.()) || tab?.url || pane?.loadedUrl || ''
    const title = tab?.title || ''
    return { hasView, navigating, url, title, documentEpoch: this.documentEpoch }
  }

  /** Reuse the injected controller `wait_check` path. Does not reveal the pane. */
  async watchWaitCheck(request: WatchWaitCheckRequest): Promise<{ ready: boolean } | { unavailable: true }> {
    const pane = this.primaryPaneIfCreated()
    const execute = pane?.view?.webContents.executeJavaScript
    if (!pane || !execute || !this.active || pane.shownTabId !== this.active.id) return { unavailable: true }
    const dispatched = untaggedRequest({
      action: 'wait_check',
      mode: request.mode,
      scope: 'viewport',
      selector: request.selector,
      idle_ms: request.idleMs,
      snapshot_id: request.snapshotId,
      element_index: request.elementIndex,
      element_token: request.elementToken,
    }, pane.kind)
    const source = `if(!globalThis.__pipiBrowserDOM){${browserDOMControllerSource}}\n;globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify(dispatched)})`
    try {
      const result = await execute.call(pane.view!.webContents, source)
      if (!result || typeof result !== 'object') return { unavailable: true }
      const rec = result as { ok?: boolean; ready?: boolean }
      return { ready: rec.ok !== false && rec.ready === true }
    } catch {
      return { unavailable: true }
    }
  }

  /** Evaluate a page expression via `executeJavaScript`. Result is used as `=== true`. */
  async watchEvaluate(expression: string): Promise<unknown> {
    const pane = this.primaryPaneIfCreated()
    const execute = pane?.view?.webContents.executeJavaScript
    if (!execute) return undefined
    return execute.call(pane.view!.webContents, expression)
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
    this.zoomByTab.delete(tabId)
    this.emit()
    if (this.active) await this.show(this.active, 'restore')
    return this.state()
  }

  async loadURL(url: string, tabId?: string): Promise<BrowserTab> {
    const target = normalizeBrowserURL(url)
    if (!target) throw new Error('请输入网址或搜索内容。')
    const tab = this.activate(tabId)
    pushTabHistory(tab, target)
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
    this.markPending(pane, { tabId: tab.id, kind: 'reload', url: tab.url || 'about:blank' })
    pane.view.webContents.reload()
    // Unlike loadURL/back/forward (which await the loadURL promise), native
    // reload() returns immediately. Await the same navigation-lifecycle settle
    // so callers never read pre-commit state off the returned tab.
    await this.navigationSettle.waitFor(pane, pane.view, BROWSER_RELOAD_SETTLE_TIMEOUT_MS)
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

  async setZoomFactor(factor: number, tabId?: string): Promise<number> {
    const tab = this.activate(tabId)
    const next = clampBrowserZoom(factor)
    this.zoomByTab.set(tab.id, next)
    const desktop = this.panes.desktop
    if (this.viewUsable(desktop.view) && desktop.shownTabId === tab.id) {
      desktop.view.webContents.setZoomFactor?.(next)
    }
    return next
  }

  private zoomForActive(): number {
    const id = this.activeTabId
    return id ? clampBrowserZoom(this.zoomByTab.get(id) ?? 1) : 1
  }

  async toolAction(request: BrowserToolRequest, options: { reveal?: boolean } = {}): Promise<BrowserToolResult> {
    const startedAt = Date.now()
    traceBrowserAction('action:start', request, { start: startedAt })
    try {
      if (options.reveal !== false) await this.revealForTool()
      const resolved = this.resolveToolTargets(request)
      if ('error' in resolved) return { ok: false, error: resolved.error }
      // A tool action that would dispatch into the page must not race an
      // in-flight main-frame commit (tool/UI navigation, sibling-pane sync, or an
      // organic link click): the evaluate would land on the outgoing document
      // with undefined results. Fail fast with a retryable structured error;
      // navigation actions themselves replace the in-flight navigation and the
      // host-side console buffer is always safe to read.
      if (!navigationExemptActions.has(request.action)) {
        const navigatingKind = resolved.kinds.find(kind => this.paneNavigationInFlight(kind))
        if (navigatingKind) {
          const failed = this.debugEnvelope(request, {
            ok: false,
            startedAt,
            code: 'browser_navigating',
            error: `browser ${request.action} cannot run while the ${navigatingKind} page navigation is in flight; retry after it settles`,
            viewportTarget: navigatingKind,
            retryable: true,
          })
          traceBrowserAction('action:end', request, { end: Date.now(), duration: Date.now() - startedAt, error: 'browser_navigating' })
          return failed
        }
      }
      if (request.action === 'navigate') {
        if (!request.url) return { ok: false, error: 'browser navigate requires url' }
        await this.loadURLForTool(request.url)
        return this.observeTargets(resolved.kinds, request)
      }
      if (request.action === 'back') { await this.goBack(); if (this.active) await this.show(this.active, 'history', true); return this.observeTargets(resolved.kinds, request) }
      if (request.action === 'forward') { await this.goForward(); if (this.active) await this.show(this.active, 'history', true); return this.observeTargets(resolved.kinds, request) }
      if (request.action === 'reload') { if (this.active) await this.show(this.active, 'reload', true); return this.observeTargets(resolved.kinds, request) }
      if (request.action === 'screenshot') return this.screenshotTargets(resolved.kinds)
      if (request.action === 'type') {
        if (request.selector) return this.selectorAction({ ...request, action: 'input', mode: 'append' }, resolved.kinds[0])
        return this.domActionOn({ ...request, action: 'input', text: request.text ?? '' }, resolved.kinds[0])
      }
      if (request.selector && !hasStructuredLocator(request) && (request.action === 'click' || request.action === 'input')) {
        return this.selectorAction(request, resolved.kinds[0])
      }
      // eval/content run against the live page directly; the structured DOM
      // controller only models observe/click/input/select/scroll/fill_form, so routing
      // these through domAction would surface "unsupported browser action".
      if (request.action === 'eval') return this.evalAction(request, resolved.kinds[0])
      if (request.action === 'script') return this.scriptAction(request, resolved.kinds[0])
      if (request.action === 'wait') return this.waitAction(request, resolved.kinds[0])
      if (request.action === 'console') return this.consoleAction(request, resolved.kinds[0])
      if (request.action === 'content') return this.contentAction(request, resolved.kinds[0])
      if (['observe', 'click', 'input', 'select', 'scroll', 'fill_form'].includes(request.action)) {
        if (request.action === 'observe') return this.observeTargets(resolved.kinds, request)
        return this.domActionOn(request, resolved.kinds[0])
      }
      return this.debugEnvelope(request, { ok: false, code: 'unknown_action', error: `unknown browser action: ${request.action}` })
    } catch (error) {
      const failed = this.debugEnvelope(request, { ok: false, startedAt, error: error instanceof Error ? error.message : String(error) })
      traceBrowserAction('action:end', request, { end: Date.now(), duration: Date.now() - startedAt, error: failed.code || 'error' })
      return failed
    } finally {
      traceBrowserAction('action:end', request, { end: Date.now(), duration: Date.now() - startedAt })
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

  /** True while the pane's main-frame document is in flux: a pending commit record or an active tab load. */
  private paneNavigationInFlight(kind: BrowserViewportKind): boolean {
    // Guard per target pane only: tab.isLoading is shared by both panes, so a
    // sibling pane finishing its load must not clear this pane's navigation
    // window, and this pane's load must not block the sibling's actions.
    const pane = this.panes[kind]
    if (!pane.view || (!pane.pending && pane.loading !== true)) return false
    // Same bound as loadURL/reload settle: a commit that never lands must not
    // keep every later tool action in browser_navigating forever.
    const startedAt = pane.pending?.startedAt ?? pane.loadingStartedAt
    if (startedAt != null && Date.now() - startedAt >= BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS) return false
    return true
  }

  private markPending(pane: ViewPane, pending: { tabId: string; kind: NavigationKind; url: string }): void {
    pane.pending = { ...pending, startedAt: Date.now() }
  }

  private debugEnvelope(request: BrowserToolRequest, extra: Record<string, unknown> = {}, options?: { truncate?: boolean }): BrowserDebugEnvelope {
    const tabId = this.active?.id
    const url = this.active?.url || this.primaryPaneIfCreated()?.loadedUrl
    const consoleTail = extra.ok === false && tabId ? this.consoles.tail(tabId) : undefined
    return buildBrowserDebugEnvelope(request, { tabId, url, consoleTail }, extra, options)
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

  private async observeTargets(kinds: BrowserViewportKind[], request: Record<string, unknown> | { scope?: string } = {}): Promise<BrowserToolResult> {
    const payload = observePayload(request)
    if (kinds.length === 1) return this.domActionOn(payload, kinds[0])
    const desktop = tagObservation(await this.domActionOn(payload, 'desktop'), 'desktop')
    const mobile = tagObservation(await this.domActionOn(payload, 'mobile'), 'mobile')
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
      return sanitizeWithController(pane, kind, { ok: true, result, viewportTarget: kind })
    } catch (error) {
      return sanitizeWithController(pane, kind, { ok: false, error: error instanceof Error ? error.message : String(error), viewportTarget: kind })
    }
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
    const source = `${controllerPrelude()};${wrapped.source}`
    const finish = async (extra: Record<string, unknown>) => {
      const envelope = this.debugEnvelope(request, extra, { truncate: false })
      const sanitized = await sanitizeWithController(pane, kind, envelope)
      if (
        sanitized.code === 'browser_redaction_capacity_exceeded'
        && extra.ok === false
        && typeof extra.code === 'string'
        && extra.code !== 'browser_redaction_capacity_exceeded'
        && extra.result == null
      ) {
        return {
          ok: false,
          code: extra.code,
          error: typeof extra.error === 'string' ? extra.error : 'browser action failed',
          redacted: true,
          viewportTarget: kind,
          ...(extra.partialSideEffects === true ? { partialSideEffects: true } : {}),
        }
      }
      const packed = truncateEnvelope(sanitized)
      if (packed.truncated) packed.value.truncated = true
      return packed.value as BrowserToolResult
    }
    try {
      const raw = await execute.call(pane.view!.webContents, source) as Record<string, unknown> | undefined
      const drift = this.contextDrift(ctx)
      if (drift) {
        return finish({
          ok: false,
          startedAt,
          code: drift,
          error: drift === 'view_recreated' ? 'browser view was recreated during script' : 'browser navigated or switched tab during script',
          partialSideEffects: true,
        })
      }
      if (!raw || typeof raw !== 'object') {
        return finish({ ok: false, startedAt, code: 'unsupported_result', error: 'browser script returned no result', partialSideEffects: true })
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
        return finish({
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
      return finish({
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
        return finish({ ok: false, startedAt, code: drift, error: 'browser page changed during script', partialSideEffects: true })
      }
      return finish({
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
    // The idle quiet window must fit inside the wait budget: the page controller
    // clamps it to 50..5000ms, so an uncapped default (>= 400ms) makes any shorter
    // timeout fail on a page with recent resource activity even if it stays quiet.
    const requestedIdleMs = (request as { idle_ms?: number }).idle_ms
    const idleQuietMs = Math.min(
      Math.min(Math.max(typeof requestedIdleMs === 'number' ? requestedIdleMs : BROWSER_WAIT_DEFAULT_IDLE_MS, 50), 5000),
      Math.max(50, timeoutMs - BROWSER_WAIT_IDLE_BUDGET_SLACK_MS),
    )
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
        // Every wait-phase evaluation races the remaining public budget: a
        // renderer/navigation commit can leave executeJavaScript pending far past a
        // short timeout, and the wait must still settle as a structured result.
        const checkEval = await this.waitPhaseEval({
          action: 'wait_check',
          mode,
          scope: request.scope ?? 'viewport',
          selector: request.selector,
          idle_ms: idleQuietMs,
          snapshot_id: request.snapshot_id,
          element_index: request.element_index,
          element_token: request.element_token,
        }, kind, pane, startedAt, timeoutMs)
        if (checkEval.timedOut) break
        const check = checkEval.result as Record<string, unknown>
        if (check.ok === false && (check.code === 'invalid_browser_wait' || check.code === 'invalid_browser_target')) {
          return this.debugEnvelope(request, { ok: false, startedAt, code: String(check.code), error: String(check.error || 'invalid wait') })
        }
        if (check.ok !== false && check.ready === true) {
          const observeScope = request.scope ?? 'viewport'
          let observation = await this.observeWithDeadline({ action: 'observe', scope: observeScope }, kind, pane, startedAt, timeoutMs)
          if (observation.ok === false) {
            // The condition was met but the immediate observation can still race a
            // navigation commit. Retry at most once, and only while the public
            // timeout still has budget: the backoff sleep must leave a positive
            // remainder (rechecked after it), and the retried observation races the
            // deadline so the wait never settles past its contract.
            const remainingAfterFirst = timeoutMs - (Date.now() - startedAt)
            if (remainingAfterFirst > 0) {
              await sleep(Math.min(80, remainingAfterFirst))
              const remainingAfterSleep = timeoutMs - (Date.now() - startedAt)
              if (remainingAfterSleep > 0) {
                observation = await this.observeWithDeadline(
                  { action: 'observe', scope: observeScope },
                  kind,
                  pane,
                  startedAt,
                  timeoutMs,
                )
              }
            }
          }
          if (observation.ok === false) {
            return this.debugEnvelope(request, {
              ok: false,
              startedAt,
              mode,
              code: 'observe_failed',
              error: String(observation.error || 'browser wait observation failed'),
              waitReady: true,
            })
          }
          return this.debugEnvelope(request, { ...observation, ok: true, startedAt, mode, ready: true })
        }
        const remaining = timeoutMs - (Date.now() - startedAt)
        if (remaining <= 0) break
        await sleep(this.waitPollSleepMs(timeoutMs, remaining))
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

  /**
   * Poll cadence between wait_check evaluations. A fixed 80ms sleep can consume
   * nearly all of a 0.1-0.3s budget after reload/scroll activity, so sub-second
   * waits poll adaptively (a quarter of the remaining budget, bounded 5..80ms)
   * while normal/long waits keep the steady 80ms cadence. The public timeout
   * itself is never relaxed.
   */
  private waitPollSleepMs(timeoutMs: number, remaining: number): number {
    const cap = timeoutMs < 1000 ? Math.max(5, Math.ceil(Math.min(remaining, timeoutMs) / 4)) : 80
    return Math.min(cap, remaining)
  }

  /**
   * Race a wait-phase page evaluation against the remaining public wait deadline.
   * The page evaluate has no timeout of its own, so it races a deadline timer:
   * loser rejections are swallowed by the guarded wrapper (never unhandled), and
   * the timer is always cleared. A timed-out outcome carries the budget that was
   * raced so callers report it without recomputing an already-elapsed clock.
   */
  private async waitPhaseEval(
    request: Record<string, unknown>,
    kind: BrowserViewportKind,
    pane: ViewPane,
    startedAt: number,
    timeoutMs: number,
  ): Promise<{ timedOut: true; remaining: number } | { timedOut: false; result: BrowserToolResult }> {
    const remaining = Math.max(0, timeoutMs - (Date.now() - startedAt))
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadlineHit = new Promise<true>(resolve => { timer = setTimeout(() => resolve(true), remaining) })
    const guarded = (async (): Promise<{ timedOut: false; result: BrowserToolResult }> => {
      try {
        return { timedOut: false, result: await this.domActionOnPane(request, kind, pane) }
      } catch (error) {
        return { timedOut: false, result: { ok: false, error: error instanceof Error ? error.message : String(error) } }
      }
    })()
    try {
      return await Promise.race([
        guarded,
        deadlineHit.then(() => ({ timedOut: true, remaining }) as const),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Observe bounded by the public wait deadline: expiry becomes a structured observe_failed. */
  private async observeWithDeadline(
    request: Record<string, unknown>,
    kind: BrowserViewportKind,
    pane: ViewPane,
    startedAt: number,
    timeoutMs: number,
  ): Promise<BrowserToolResult> {
    const outcome = await this.waitPhaseEval(request, kind, pane, startedAt, timeoutMs)
    if (outcome.timedOut) {
      return { ok: false, code: 'observe_failed', error: `browser wait observation exceeded the remaining ${outcome.remaining}ms wait budget` }
    }
    return outcome.result
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
      const sanitized = await sanitizeWithController(pane, kind, {
        ok: true,
        content: full,
        truncated: full.length > 100_000,
        viewportTarget: kind,
      })
      if (sanitized.ok && typeof sanitized.content === 'string' && sanitized.content.length > 100_000) {
        return { ...sanitized, content: sanitized.content.slice(0, 100_000), truncated: true }
      }
      return sanitized
    } catch (error) {
      return sanitizeWithController(pane, kind, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        viewportTarget: kind,
      })
    }
  }

  private async domActionOn(request: Record<string, unknown>, kind: BrowserViewportKind): Promise<BrowserToolResult> {
    const pane = await this.ensureToolPage(kind)
    return this.domActionOnPane(request, kind, pane)
  }

  private async domActionOnPane(request: Record<string, unknown>, kind: BrowserViewportKind, pane: ViewPane): Promise<BrowserToolResult> {
    const execute = pane.view?.webContents.executeJavaScript
    if (!execute || !this.active || pane.shownTabId !== this.active.id) return { ok: false, error: 'browser page is unavailable' }
    const dispatched = untaggedRequest(request, kind)
    const source = `if(!globalThis.__pipiBrowserDOM){${browserDOMControllerSource}}\n;globalThis.__pipiBrowserDOM.dispatch(${JSON.stringify(dispatched)})`
    const result = await execute.call(pane.view!.webContents, source)
    if (!result || typeof result !== 'object') return { ok: false, error: 'browser action returned no result' }
    return tagObservation(result as BrowserToolResult, kind)
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
      pushTabHistory(tab, target)
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
    const action = JSON.stringify(request.action)
    const code = `${controllerPrelude()}(()=>{const api=globalThis.__pipiBrowserDOM;const e=document.querySelector(${selector});if(!e)return {ok:false,error:'selector not found'};if(api&&typeof api.isSensitive==='function'&&api.isSensitive(e))return {ok:false,error:'This sensitive field requires user input.',code:'user_handoff_required',requiresUserInput:true};if(${action}==='click'){e.click();return {ok:true}};const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;p?p.call(e,${append ? `String(e.value??'')+${text}` : text}):e.value=${text};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()`
    try {
      const result = await execute.call(pane.view!.webContents, code)
      if (!result || typeof result !== 'object' || !(result as any).ok) {
        return sanitizeWithController(pane, kind, (result && typeof result === 'object' ? result : { ok: false, error: 'selector not found' }) as BrowserToolResult)
      }
      const observed = await this.domActionOnPane({ action: 'observe', scope: request.scope ?? 'viewport' }, kind, pane)
      return sanitizeWithController(pane, kind, observed)
    } catch (error) {
      return sanitizeWithController(pane, kind, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        viewportTarget: kind,
      })
    }
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
    applyViewport(pane.view, 'mobile', this.mobileWindowViewport, true, this.mobileDevice, 1)
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
    this.certificateErrorApp?.off?.('certificate-error', this.handleAppCertificateError)
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
    applyViewport(view, pane.kind, visual, presented, this.mobileDevice, this.zoomForActive())
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
      pane.loading = undefined
      pane.loadingStartedAt = undefined
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
    pane.loading = undefined
    pane.loadingStartedAt = undefined
    if (!this.attach) throw new Error('browser window is unavailable')
    const view = this.createView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: this.partition } })
    pane.view = view
    this.viewGeneration += 1
    this.applyMobileUserAgent(pane)
    setNativeBounds(view, hiddenPresetBounds(kind, this.mobileDevice))
    view.setVisible?.(false)
    this.hookConsole(pane, view.webContents)
    if (shouldOpenBrowserDevTools() && !view.webContents.isDevToolsOpened?.()) {
      view.webContents.openDevTools?.({ mode: 'detach' })
    }
    view.webContents.on('destroyed', () => {
      if (pane.view !== view) return
      this.beginViewRetirement(pane, view)
    })
    view.webContents.on('did-start-loading', () => {
      if (pane.view !== view) return
      this.documentEpoch += 1
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
      this.pendingDocumentOwnerTabIds[pane.kind] = undefined
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
      // A committed document clears the cert dedupe and needs a fresh dialog
      // hook: the new nonce retires the previous document's markers.
      this.lastCertificateError = undefined
      this.commitDocumentOwner(pane.kind)
      this.didNavigate(pane, url)
      const nonce = newDialogNonce()
      this.dialogNonces.set(view.webContents, nonce)
      installJsDialogReporter(view.webContents, nonce)
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
  private hookConsole(pane: ViewPane, contents: BrowserWebContentsLike): void {
    if (this.consoles.isHooked(contents) || this.consoleListeners.has(contents)) return
    const listener = createConsoleEntryListener(pane, contents, {
      ownerTabId: () => this.documentOwnerTabIds[pane.kind],
      fallbackUrl: () => this.primaryPaneIfCreated()?.loadedUrl,
      buffer: this.consoles,
      onNotice: event => this.emitNotice(event),
      isValidDialogNonce: nonce => this.dialogNonces.get(contents) === nonce,
    })
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
    this.navigationSettle.notify(pane)
    if (pane.view === view) {
      this.unhookConsole(view.webContents)
      this.dialogNonces.delete(view.webContents)
      pane.view = undefined
      pane.shownTabId = undefined
      pane.loadedUrl = undefined
      pane.attachedVisible = undefined
      pane.pending = undefined
      pane.loading = undefined
      this.viewGeneration += 1
      this.documentEpoch += 1
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
    if (this.createdPanes().length === 0) {
      this.watchLifecycleListeners.forEach(listener => listener({ type: 'destroyed' }))
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
      this.documentOwnerTabIds[pane.kind] = tab.id
      this.pendingDocumentOwnerTabIds[pane.kind] = undefined
      return
    }
    pane.shownTabId = tab.id
    this.pendingDocumentOwnerTabIds[pane.kind] = tab.id
    this.navigationGeneration += 1
    this.markPending(pane, { tabId: tab.id, kind, url })
    tab.isLoading = true
    this.emit()
    try {
      await awaitLoadURL(Promise.resolve(view.webContents.loadURL(url)))
      pane.loadedUrl = url
    } catch (error) {
      if (pane.pending?.tabId === tab.id) pane.pending = undefined
      if (this.pendingDocumentOwnerTabIds[pane.kind] === tab.id) this.pendingDocumentOwnerTabIds[pane.kind] = undefined
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
        this.pendingDocumentOwnerTabIds[pane.kind] = tab.id
        this.markPending(retry, { tabId: tab.id, kind, url })
        tab.isLoading = true
        this.emit()
        try {
          await awaitLoadURL(Promise.resolve(retry.view.webContents.loadURL(url)))
          retry.loadedUrl = url
        } catch (retryError) {
          if (retry.pending?.tabId === tab.id) retry.pending = undefined
          if (this.pendingDocumentOwnerTabIds[pane.kind] === tab.id) this.pendingDocumentOwnerTabIds[pane.kind] = undefined
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
    for (const kind of ['desktop', 'mobile'] as const) {
      this.documentOwnerTabIds[kind] = undefined
      this.pendingDocumentOwnerTabIds[kind] = undefined
    }
  }

  private commitDocumentOwner(kind: BrowserViewportKind): void {
    const pending = this.pendingDocumentOwnerTabIds[kind]
    if (!pending) return
    this.documentOwnerTabIds[kind] = pending
    this.pendingDocumentOwnerTabIds[kind] = undefined
  }

  private navigationTab(pane: ViewPane): BrowserTabRecord | undefined {
    return pane.pending ? this.tabs.find(tab => tab.id === pane.pending!.tabId) : this.active
  }

  private setLoading(pane: ViewPane, isLoading: boolean): void {
    // Per-pane load state first: tab.isLoading is shared by both panes, so it
    // must never gate per-pane navigation guards.
    pane.loading = isLoading
    if (isLoading) pane.loadingStartedAt ??= Date.now()
    else pane.loadingStartedAt = undefined
    const tab = this.navigationTab(pane)
    if (!tab) return
    tab.isLoading = isLoading
    if (!isLoading) {
      pane.pending = undefined
      this.navigationSettle.notify(pane)
    }
    this.emit()
  }

  private didNavigate(pane: ViewPane, url: string): void {
    pane.loadedUrl = url
    const tab = this.navigationTab(pane)
    if (!tab) return
    const pending = pane.pending
    if (pending?.kind === 'push') {
      if (tab.historyIndex >= 0) tab.history[tab.historyIndex] = url
      else pushTabHistory(tab, url)
    } else if (pending?.kind === 'history') {
      tab.history[tab.historyIndex] = url
    } else if (!pending || pending.kind === 'reload') {
      pushTabHistory(tab, url)
    } else if (pending.kind === 'restore' && tab.url) {
      tab.url = url
      if (tab.historyIndex >= 0) tab.history[tab.historyIndex] = url
    }
    if (url !== 'about:blank' || tab.url) {
      tab.url = url
      if (!tab.title || tab.title === '新标签页') tab.title = tabTitle(url)
    }
    syncTabNavigationButtons(tab)
    this.emit()
    if (!pending) this.syncSiblingPane(pane, tab, url)
  }

  private syncSiblingPane(source: ViewPane, tab: BrowserTabRecord, url: string): void {
    for (const pane of this.createdPanes()) {
      if (pane.kind === source.kind || !pane.view) continue
      const current = pane.view.webContents.getURL?.() || pane.loadedUrl
      if (current === url) continue
      this.markPending(pane, { tabId: tab.id, kind: 'restore', url })
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
    this.markPending(pane, { tabId: this.active?.id ?? pane.shownTabId ?? '', kind: 'reload', url })
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

  /** Fan out a panel-only notice (console / certificate / JS dialog); no tab state change. */
  private emitNotice(event: BrowserSpaceEvent): void {
    this.listeners.forEach(listener => listener(event))
  }

  }
