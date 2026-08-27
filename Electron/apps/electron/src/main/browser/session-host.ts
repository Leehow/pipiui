/**
 * BrowserSessionHost: per-session browser spaces with independent operation
 * queues and the watch registry glue. See the class doc below for the model.
 */
import type {
  BrowserHostAPI,
  BrowserSnapshot,
  BrowserTab,
  BrowserTabOptions,
  BrowserTabsSnapshot,
  BrowserToolRequest,
  BrowserToolResult,
  BrowserViewBounds,
  Unsubscribe
} from '@pipi/host-api'
import type { BrowserSurfaceEvent, BrowserWatchInfo, BrowserWatchSnapshotEvent } from '@pipi/host-api/browser'
import {
  WatcherRegistry,
  type WatchPageSummary,
  type WatchRecord,
  type WatchRegisterInput,
  type WatchRegisterResult,
  type WatchTriggerHandler,
  type WatchTriggerReason,
  type WatchUnwatchResult,
  type WatchWaitCheckRequest,
} from '../watcher-registry.js'
import { BrowserTabsHost } from './tabs-host.js'
import { browserPartitionForSession } from './tab-model.js'
import type { BrowserCertificateErrorAppLike, BrowserSessionViewAttach, BrowserViewFactory } from './types.js'
import { hiddenBounds } from './types.js'

type BrowserSessionRecord = {
  host: BrowserTabsHost
  unsubscribe: Unsubscribe
  tail: Promise<void>
  disposing: boolean
}

type BrowserBoundsScaleProvider = () => number

function readBoundsScale(provider: BrowserBoundsScaleProvider): number {
  try {
    const scale = provider()
    return Number.isFinite(scale) && scale > 0 ? scale : 1
  } catch {
    return 1
  }
}

function scaleBrowserViewBounds(bounds: BrowserViewBounds, scale: number): BrowserViewBounds {
  if (scale === 1) return bounds
  const scaleRect = (rect: { x: number; y: number; width: number; height: number }) => ({
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  })
  const slots = bounds.slots
    ? {
        ...(bounds.slots.desktop ? { desktop: scaleRect(bounds.slots.desktop) } : {}),
        ...(bounds.slots.mobile ? { mobile: scaleRect(bounds.slots.mobile) } : {}),
      }
    : undefined
  return { ...bounds, ...scaleRect(bounds), ...(slots ? { slots } : {}) }
}

function toBrowserWatchInfo(watch: WatchRecord): BrowserWatchInfo {
  return {
    watchId: watch.watchId,
    condition: watch.condition,
    createdAt: watch.createdAt,
    timeoutAt: Number.isFinite(watch.timeoutAt) ? watch.timeoutAt : null,
    intervalMs: watch.intervalMs,
    status: watch.status
  }
}

/**
 * One browser space per authenticated Pi session. Each record owns up to two
 * physical WebContentsViews (desktop + mobile child window), one Chromium
 * storage partition, virtual tabs, and an operation queue. Queues are
 * independent, so background sessions never block each other.
 */
export type BrowserSessionHostOptions = {
  /** Optional at construct time; `setWatchTrigger` can attach it later for the bridge. */
  onWatchTrigger?: WatchTriggerHandler
  now?: () => number
  watchIntervalMs?: number
  /** App-level `certificate-error` source shared by every session's tab host; Electron emits this event from `app`. */
  certificateErrorApp?: BrowserCertificateErrorAppLike
}

export class BrowserSessionHost implements BrowserHostAPI {
  private readonly records = new Map<string, BrowserSessionRecord>()
  /** Sessions that have been disposeSession'd; missing record is otherwise "not created yet". */
  private readonly disposedSessionIds = new Set<string>()
  private readonly listeners = new Set<(event: BrowserSurfaceEvent) => void>()
  private attach?: BrowserSessionViewAttach
  private boundsScale: BrowserBoundsScaleProvider = () => 1
  private readonly certificateErrorApp?: BrowserCertificateErrorAppLike
  private selectedSessionId?: string
  private visibleSessionId?: string
  /** Long-lived page watches. Bridge tasks call `setWatchTrigger` then `registerWatch`. */
  readonly watchers: WatcherRegistry

  constructor(private readonly createView: BrowserViewFactory, options: BrowserSessionHostOptions = {}) {
    this.certificateErrorApp = options.certificateErrorApp
    this.watchers = new WatcherRegistry({
      page: this.watchPageAccess(),
      // Panel visibility rides the same single-trigger pipe; the bridge
      // handler (attached later via setWatchTrigger) still sees every firing.
      onTrigger: (watch, reason, summary) => {
        this.emitWatchFired(watch, reason, summary)
        options.onWatchTrigger?.(watch, reason, summary)
      },
      now: options.now,
      intervalMs: options.watchIntervalMs,
    })
  }

  /** Later bridge work attaches follow-up delivery here. Default is a no-op. */
  setWatchTrigger(handler: WatchTriggerHandler): void {
    this.watchers.setTrigger((watch, reason, summary) => {
      this.emitWatchFired(watch, reason, summary)
      handler(watch, reason, summary)
    })
  }

  /** Register a one-shot page watch for `sessionKey`. */
  registerWatch(input: WatchRegisterInput): WatchRegisterResult {
    const result = this.watchers.register(input)
    if (result.ok) this.emitWatchList(result.watch.sessionKey)
    return result
  }

  /** Cancel a watch without firing the trigger. Missing ids still return ok. */
  unwatch(watchId: string): WatchUnwatchResult {
    const owner = this.watchers.list().find(watch => watch.watchId === watchId)?.sessionKey
    const result = this.watchers.unwatch(watchId)
    if (owner) this.emitWatchList(owner)
    return result
  }

  /** List active watches, optionally filtered by session. */
  listWatches(sessionKey?: string) {
    return this.watchers.list(sessionKey)
  }

  private emitWatchList(sessionKey: string): void {
    const event: BrowserWatchSnapshotEvent = { type: 'watch', sessionId: sessionKey, watches: this.watchers.list(sessionKey).map(toBrowserWatchInfo) }
    this.listeners.forEach(listener => listener(event))
  }

  private emitWatchFired(watch: WatchRecord, reason: WatchTriggerReason, summary: WatchPageSummary): void {
    const firedAt = Date.now()
    const event: BrowserWatchSnapshotEvent = {
      type: 'watch',
      sessionId: watch.sessionKey,
      watches: this.watchers.list(watch.sessionKey).map(toBrowserWatchInfo),
      trigger: { watchId: watch.watchId, reason, waitedMs: firedAt - watch.createdAt, url: summary.url, title: summary.title, firedAt }
    }
    this.listeners.forEach(listener => listener(event))
  }

  attachToWindow(attach: BrowserSessionViewAttach, boundsScale: BrowserBoundsScaleProvider = () => 1): void {
    this.attach = attach
    this.boundsScale = boundsScale
    for (const [sessionId, record] of this.records) {
      record.host.attachToWindow((view, placement, kind, device) => attach(sessionId, view, placement, kind, device))
    }
  }

  detachWindow(): void {
    for (const record of this.records.values()) record.host.detachWindow()
    this.attach = undefined
    this.boundsScale = () => 1
    this.visibleSessionId = undefined
  }

  async selectSession(sessionId: string): Promise<void> {
    this.selectedSessionId = sessionId
    // Hydration snapshot: the panel has no list-RPC on the host contract, so
    // every (re)select re-announces the active watch set as a `watch` event;
    // later updates ride the register/unwatch/fire events.
    this.emitWatchList(sessionId)
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
  setZoomFactor(sessionId: string, factor: number, tabId?: string): Promise<number> { return this.run(sessionId, host => host.setZoomFactor(factor, tabId)) }

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
    const nativeBounds = scaleBrowserViewBounds(bounds, readBoundsScale(this.boundsScale))
    const needsRestore = await record.host.setViewBounds(nativeBounds, false)
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

  subscribe(listener: (event: BrowserSurfaceEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async disposeSession(sessionId: string): Promise<void> {
    this.disposedSessionIds.add(sessionId)
    this.watchers.notifyDisposed(sessionId)
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
    const host = new BrowserTabsHost(this.createView, browserPartitionForSession(id), this.certificateErrorApp)
    if (this.attach) host.attachToWindow((view, placement, kind, device) => this.attach?.(id, view, placement, kind, device))
    const record = { host, tail: Promise.resolve(), disposing: false, unsubscribe: () => undefined }
    const unsubscribeEvents = host.subscribe(event => {
      if (event.type === 'reveal' && id !== this.selectedSessionId) return
      const scoped = { ...event, sessionId: id } as BrowserSurfaceEvent
      this.listeners.forEach(listener => listener(scoped))
    })
    const unsubscribeWatch = host.subscribeWatchLifecycle(() => {
      if (record.disposing) return
      this.watchers.notifyDisposed(id)
    })
    record.unsubscribe = () => {
      unsubscribeEvents()
      unsubscribeWatch()
    }
    this.disposedSessionIds.delete(id)
    this.records.set(id, record)
    return record
  }

  private watchPageAccess() {
    const inspect = (sessionKey: string) => this.records.get(sessionKey)?.host.watchInspect()
    const summary = (sessionKey: string): WatchPageSummary => {
      const state = inspect(sessionKey)
      return { url: state?.url ?? '', title: state?.title ?? '' }
    }
    return {
      sessionAlive: (sessionKey: string) => {
        const record = this.records.get(sessionKey)
        if (record) return !record.disposing
        return !this.disposedSessionIds.has(sessionKey)
      },
      hasView: (sessionKey: string) => inspect(sessionKey)?.hasView === true,
      isNavigating: (sessionKey: string) => inspect(sessionKey)?.navigating === true,
      getPageSummary: summary,
      getURL: (sessionKey: string) => inspect(sessionKey)?.url ?? '',
      getNavigationEpoch: (sessionKey: string) => inspect(sessionKey)?.documentEpoch ?? 0,
      waitCheck: (sessionKey: string, request: WatchWaitCheckRequest) => {
        const record = this.records.get(sessionKey)
        if (!record || record.disposing) return Promise.resolve({ unavailable: true as const })
        return record.host.watchWaitCheck(request)
      },
      evaluate: (sessionKey: string, expression: string) => {
        const record = this.records.get(sessionKey)
        if (!record || record.disposing) return Promise.resolve(undefined)
        return record.host.watchEvaluate(expression)
      },
    }
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
