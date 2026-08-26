/**
 * Host-side browser watch registry.
 *
 * Boss `browser wait` is capped at 25s inside one tool call. This registry
 * holds long-lived one-shot conditions, polls the live WebView on a single
 * shared timer, and invokes `onTrigger` when a condition matches, times out,
 * or the page/session goes away. The completion/follow-up bridge is wired by
 * a later task — this module only owns records, polling, and the hook.
 */

/** Shared poll interval. Per-watch `intervalMs` can only slow a watch down. */
export const WATCHER_DEFAULT_INTERVAL_MS = 2_000

/** Hard cap for one in-flight evaluate/waitCheck so a hung renderer cannot pin `checking`. */
export const WATCHER_CHECK_TIMEOUT_MS = 10_000

/**
 * Per-session watch ceiling. Watches are one-shot but long-lived (up to 30min),
 * each polls the live WebView off one shared timer, and nothing else bounded the
 * registry: a runaway loop registering per-iteration watches could accumulate
 * unbounded Map entries and evaluates. 8 keeps a healthy multi-watch session
 * working while bounding the resource cost per session.
 */
export const WATCHER_MAX_WATCHES_PER_SESSION = 8

/** Why a one-shot watch fired. The record is unregistered before the callback. */
export type WatchTriggerReason = 'matched' | 'timeout' | 'disposed' | 'navigating-lost'

/** Public lifecycle of a registered watch. `checking` means a tick is in flight. */
export type WatchStatus = 'active' | 'checking'

/**
 * Completion condition. `timer` never matches — it only fires `timeout` at
 * `timeoutAt`. `selector` / `idle` reuse the injected DOM controller's
 * `wait_check`. `url_matches` reads `webContents` URL. `expression` must
 * evaluate to strictly `=== true`.
 */
export type WatchCondition =
  | { type: 'selector'; selector: string; snapshotId?: string; elementIndex?: number; elementToken?: string }
  | { type: 'idle'; idleMs?: number }
  | { type: 'url_matches'; pattern: string }
  | { type: 'expression'; expression: string }
  | { type: 'timer' }

/** Durable watch record returned by `register` / `list`. */
export type WatchRecord = {
  watchId: string
  sessionKey: string
  condition: WatchCondition
  createdAt: number
  timeoutAt: number
  intervalMs: number
  status: WatchStatus
}

/** Snapshot handed to `onTrigger`. Title may be empty if the tab has none yet. */
export type WatchPageSummary = {
  url: string
  title: string
}

export type WatchWaitCheckRequest = {
  mode: 'selector' | 'idle'
  selector?: string
  idleMs?: number
  snapshotId?: string
  elementIndex?: number
  elementToken?: string
}

export type WatchRegisterInput = {
  sessionKey: string
  condition: WatchCondition
  /** Absolute deadline (epoch ms). Overrides `timeoutMs` when both are set. */
  timeoutAt?: number
  /** Relative deadline from `createdAt`. Required for `timer` unless `timeoutAt` is set. */
  timeoutMs?: number
  /** Minimum time between checks for this watch. Floor is the shared interval. */
  intervalMs?: number
  /** Caller-supplied id. A unique id is generated when omitted. */
  watchId?: string
}

export type WatchRegisterResult =
  | { ok: true; watch: WatchRecord }
  | { ok: false; error: string; code?: string; limit?: number }

export type WatchUnwatchResult = { ok: true }

/**
 * Page probe used by the registry. Implementations must not create, reveal,
 * or navigate WebViews — they only inspect the already-live pane.
 */
export interface WatcherPageAccess {
  /** False only when the session is known-dead (disposing / already gone after create). */
  sessionAlive(sessionKey: string): boolean
  /** True when a usable WebContents exists for the session. */
  hasView(sessionKey: string): boolean
  /** True while main-frame navigation or reload is in flight. */
  isNavigating(sessionKey: string): boolean
  getPageSummary(sessionKey: string): WatchPageSummary
  getURL(sessionKey: string): string
  /** Document generation. Changes when the page starts a load or the view is retired. */
  getNavigationEpoch?(sessionKey: string): number
  waitCheck(sessionKey: string, request: WatchWaitCheckRequest): Promise<{ ready: boolean } | { unavailable: true }>
  evaluate(sessionKey: string, expression: string): Promise<unknown>
}

/**
 * Invoked once per watch, after the record is removed.
 * Later bridge work should send a follow-up turn from here.
 */
export type WatchTriggerHandler = (
  watch: WatchRecord,
  reason: WatchTriggerReason,
  pageSummary: WatchPageSummary,
) => void

export type WatcherRegistryOptions = {
  page: WatcherPageAccess
  /** Optional at construct time; `setTrigger` can attach it later. */
  onTrigger?: WatchTriggerHandler
  now?: () => number
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (id: ReturnType<typeof setInterval>) => void
  /** Shared timer period. Default 2000ms. */
  intervalMs?: number
  /** Per-check hard timeout. Default 10000ms. */
  checkTimeoutMs?: number
  /** Per-session watch ceiling. Default WATCHER_MAX_WATCHES_PER_SESSION. */
  maxWatchesPerSession?: number
  setTimeout?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (id: ReturnType<typeof setTimeout>) => void
  watchId?: () => string
}

type InternalWatch = WatchRecord & {
  checking: boolean
  lastCheckedAt: number
  urlRegex?: RegExp
}

const emptySummary: WatchPageSummary = { url: '', title: '' }

/**
 * One registry per `BrowserSessionHost`. A single `setInterval` walks every
 * active watch; a watch whose previous async check is still running is skipped.
 */
export class WatcherRegistry {
  private readonly page: WatcherPageAccess
  private readonly now: () => number
  private readonly setIntervalFn: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  private readonly clearIntervalFn: (id: ReturnType<typeof setInterval>) => void
  private readonly intervalMs: number
  private readonly checkTimeoutMs: number
  private readonly maxWatchesPerSession: number
  private readonly setTimeoutFn: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  private readonly clearTimeoutFn: (id: ReturnType<typeof setTimeout>) => void
  private readonly nextWatchId: () => string
  private readonly watches = new Map<string, InternalWatch>()
  private onTrigger: WatchTriggerHandler
  private timer: ReturnType<typeof setInterval> | undefined
  private sequence = 0

  constructor(options: WatcherRegistryOptions) {
    this.page = options.page
    this.onTrigger = options.onTrigger ?? (() => undefined)
    this.now = options.now ?? Date.now
    this.setIntervalFn = options.setInterval ?? setInterval
    this.clearIntervalFn = options.clearInterval ?? clearInterval
    this.intervalMs = Math.max(50, options.intervalMs ?? WATCHER_DEFAULT_INTERVAL_MS)
    this.checkTimeoutMs = Math.max(1, options.checkTimeoutMs ?? WATCHER_CHECK_TIMEOUT_MS)
    this.maxWatchesPerSession = Math.max(1, Math.floor(options.maxWatchesPerSession ?? WATCHER_MAX_WATCHES_PER_SESSION))
    this.setTimeoutFn = options.setTimeout ?? setTimeout
    this.clearTimeoutFn = options.clearTimeout ?? clearTimeout
    this.nextWatchId = options.watchId ?? (() => `bw-${++this.sequence}-${this.now().toString(36)}`)
  }

  /**
   * Replace the trigger callback. Bridge tasks call this once they can
   * inject a follow-up; the default is a no-op.
   */
  setTrigger(handler: WatchTriggerHandler): void {
    this.onTrigger = handler
  }

  /**
   * Register a one-shot watch. Invalid input returns `{ ok: false }` and
   * does not start polling.
   */
  register(input: WatchRegisterInput): WatchRegisterResult {
    const sessionKey = typeof input.sessionKey === 'string' ? input.sessionKey.trim() : ''
    if (!sessionKey) return { ok: false, error: 'watch requires sessionKey' }
    const parsed = parseCondition(input.condition)
    if (!parsed.ok) return parsed
    const createdAt = this.now()
    const timeoutAt = resolveTimeoutAt(input, createdAt, parsed.condition.type === 'timer')
    if (timeoutAt == null) return { ok: false, error: 'timer watch requires timeoutAt or timeoutMs' }
    const intervalMs = Math.max(this.intervalMs, Math.floor(input.intervalMs ?? this.intervalMs))
    const watchId = (typeof input.watchId === 'string' && input.watchId.trim()) || this.nextWatchId()
    if (this.watches.has(watchId)) return { ok: false, error: `watch already exists: ${watchId}` }
    // The registry is long-lived and watches are one-shot; without a per-session
    // ceiling a runaway loop could register unbounded records. The cap frees up
    // again as watches fire or are unwatched.
    const sessionWatchCount = [...this.watches.values()].reduce((count, watch) => watch.sessionKey === sessionKey ? count + 1 : count, 0)
    if (sessionWatchCount >= this.maxWatchesPerSession) {
      return {
        ok: false,
        error: `browser watch limit reached for this session (${this.maxWatchesPerSession} active watches); unwatch one before registering another`,
        code: 'browser_watch_limit_exceeded',
        limit: this.maxWatchesPerSession,
      }
    }
    const record: InternalWatch = {
      watchId,
      sessionKey,
      condition: parsed.condition,
      createdAt,
      timeoutAt,
      intervalMs,
      status: 'active',
      checking: false,
      lastCheckedAt: 0,
      urlRegex: parsed.urlRegex,
    }
    this.watches.set(watchId, record)
    this.ensureTimer()
    return { ok: true, watch: publicWatch(record) }
  }

  /**
   * Cancel a watch without firing `onTrigger`. Missing ids still return ok.
   */
  unwatch(watchId: string): WatchUnwatchResult {
    const id = typeof watchId === 'string' ? watchId.trim() : ''
    if (id) this.watches.delete(id)
    this.stopTimerIfIdle()
    return { ok: true }
  }

  /** Active watches, optionally filtered by session. */
  list(sessionKey?: string): WatchRecord[] {
    const key = typeof sessionKey === 'string' ? sessionKey.trim() : ''
    const out: WatchRecord[] = []
    for (const watch of this.watches.values()) {
      if (key && watch.sessionKey !== key) continue
      out.push(publicWatch(watch))
    }
    return out
  }

  /** Session teardown or WebView destroy: fire `disposed` and drop every watch. */
  notifyDisposed(sessionKey: string): void {
    this.finishSession(sessionKey, 'disposed')
  }

  /**
   * Terminal page loss that is not a session dispose (reserved hook).
   * Ordinary navigation does **not** call this — in-flight nav only skips a tick.
   */
  notifyNavigatingLost(sessionKey: string): void {
    this.finishSession(sessionKey, 'navigating-lost')
  }

  /** Stop the shared timer and drop every watch without callbacks. */
  dispose(): void {
    this.watches.clear()
    this.stopTimer()
  }

  /** Test/host hook: run one poll immediately. */
  async tick(): Promise<void> {
    const now = this.now()
    const snapshot = [...this.watches.values()]
    const work: Promise<void>[] = []
    for (const watch of snapshot) {
      if (!this.watches.has(watch.watchId)) continue
      if (watch.checking) continue
      if (!this.page.sessionAlive(watch.sessionKey)) {
        this.finish(watch, 'disposed')
        continue
      }
      if (now >= watch.timeoutAt && watch.condition.type === 'timer') {
        this.finish(watch, 'timeout')
        continue
      }
      if (this.page.isNavigating(watch.sessionKey)) {
        if (now >= watch.timeoutAt) this.finish(watch, 'timeout')
        continue
      }
      if (!this.page.hasView(watch.sessionKey)) {
        if (now >= watch.timeoutAt) this.finish(watch, 'timeout')
        continue
      }
      if (watch.lastCheckedAt > 0 && now - watch.lastCheckedAt < watch.intervalMs && now < watch.timeoutAt) {
        continue
      }
      if (now >= watch.timeoutAt && watch.condition.type !== 'timer') {
        // Prefer a same-tick match over timeout.
      }
      watch.checking = true
      watch.status = 'checking'
      watch.lastCheckedAt = now
      work.push(this.checkOne(watch, now))
    }
    await Promise.all(work)
  }

  private async checkOne(watch: InternalWatch, now: number): Promise<void> {
    const urlBefore = this.page.getURL(watch.sessionKey)
    const epochBefore = this.page.getNavigationEpoch?.(watch.sessionKey)
    try {
      const matched = await this.withCheckTimeout(this.evaluate(watch))
      if (!this.watches.has(watch.watchId)) return
      if (matched === 'timed_out') {
        if (this.now() >= watch.timeoutAt) this.finish(watch, 'timeout')
        return
      }
      if (this.documentChanged(watch.sessionKey, urlBefore, epochBefore)) {
        if (this.now() >= watch.timeoutAt) this.finish(watch, 'timeout')
        return
      }
      if (matched === true) {
        this.finish(watch, 'matched')
        return
      }
      if (now >= watch.timeoutAt) {
        this.finish(watch, 'timeout')
      }
    } catch {
      if (this.watches.has(watch.watchId) && now >= watch.timeoutAt) this.finish(watch, 'timeout')
    } finally {
      if (this.watches.has(watch.watchId)) {
        watch.checking = false
        watch.status = 'active'
      }
    }
  }

  private documentChanged(sessionKey: string, urlBefore: string, epochBefore: number | undefined): boolean {
    if (this.page.isNavigating(sessionKey)) return true
    if (this.page.getURL(sessionKey) !== urlBefore) return true
    if (epochBefore != null && this.page.getNavigationEpoch?.(sessionKey) !== epochBefore) return true
    return false
  }

  private async withCheckTimeout(work: Promise<boolean>): Promise<boolean | 'timed_out'> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<'timed_out'>(resolve => {
          timer = this.setTimeoutFn(() => resolve('timed_out'), this.checkTimeoutMs)
        }),
      ])
    } finally {
      if (timer !== undefined) this.clearTimeoutFn(timer)
    }
  }

  private async evaluate(watch: InternalWatch): Promise<boolean> {
    const condition = watch.condition
    if (condition.type === 'timer') return false
    if (condition.type === 'url_matches') {
      const url = this.page.getURL(watch.sessionKey)
      return Boolean(watch.urlRegex && url && watch.urlRegex.test(url))
    }
    if (condition.type === 'expression') {
      const result = await this.page.evaluate(watch.sessionKey, condition.expression)
      return result === true
    }
    const check = await this.page.waitCheck(watch.sessionKey, {
      mode: condition.type,
      selector: condition.type === 'selector' ? condition.selector : undefined,
      idleMs: condition.type === 'idle' ? condition.idleMs : undefined,
      snapshotId: condition.type === 'selector' ? condition.snapshotId : undefined,
      elementIndex: condition.type === 'selector' ? condition.elementIndex : undefined,
      elementToken: condition.type === 'selector' ? condition.elementToken : undefined,
    })
    if ('unavailable' in check) return false
    return check.ready === true
  }

  private finishSession(sessionKey: string, reason: WatchTriggerReason): void {
    const key = sessionKey.trim()
    if (!key) return
    for (const watch of [...this.watches.values()]) {
      if (watch.sessionKey === key) this.finish(watch, reason)
    }
  }

  private finish(watch: InternalWatch, reason: WatchTriggerReason): void {
    if (!this.watches.delete(watch.watchId)) return
    this.stopTimerIfIdle()
    const summary = this.safeSummary(watch.sessionKey)
    try {
      this.onTrigger(publicWatch(watch), reason, summary)
    } catch {
      // Trigger failures must not break other watches or the shared timer.
    }
  }

  private safeSummary(sessionKey: string): WatchPageSummary {
    try {
      const summary = this.page.getPageSummary(sessionKey)
      if (!summary || typeof summary !== 'object') return emptySummary
      return {
        url: typeof summary.url === 'string' ? summary.url : '',
        title: typeof summary.title === 'string' ? summary.title : '',
      }
    } catch {
      return emptySummary
    }
  }

  private ensureTimer(): void {
    if (this.timer || this.watches.size === 0) return
    this.timer = this.setIntervalFn(() => {
      void this.tick()
    }, this.intervalMs)
    const handle = this.timer as { unref?: () => void }
    handle.unref?.()
  }

  private stopTimerIfIdle(): void {
    if (this.watches.size === 0) this.stopTimer()
  }

  private stopTimer(): void {
    if (this.timer === undefined) return
    this.clearIntervalFn(this.timer)
    this.timer = undefined
  }
}

function publicWatch(watch: InternalWatch): WatchRecord {
  return {
    watchId: watch.watchId,
    sessionKey: watch.sessionKey,
    condition: watch.condition,
    createdAt: watch.createdAt,
    timeoutAt: watch.timeoutAt,
    intervalMs: watch.intervalMs,
    status: watch.checking ? 'checking' : 'active',
  }
}

function resolveTimeoutAt(input: WatchRegisterInput, createdAt: number, isTimer: boolean): number | undefined {
  if (typeof input.timeoutAt === 'number' && Number.isFinite(input.timeoutAt)) return input.timeoutAt
  if (typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) && input.timeoutMs >= 0) {
    return createdAt + input.timeoutMs
  }
  if (isTimer) return undefined
  return Number.POSITIVE_INFINITY
}

function parseCondition(condition: WatchCondition | undefined):
  | { ok: true; condition: WatchCondition; urlRegex?: RegExp }
  | { ok: false; error: string } {
  if (!condition || typeof condition !== 'object' || typeof condition.type !== 'string') {
    return { ok: false, error: 'watch requires a condition' }
  }
  if (condition.type === 'timer') return { ok: true, condition: { type: 'timer' } }
  if (condition.type === 'idle') {
    const idleMs = condition.idleMs
    if (idleMs != null && !(typeof idleMs === 'number' && Number.isFinite(idleMs) && idleMs > 0)) {
      return { ok: false, error: 'idle watch idleMs must be a positive number' }
    }
    return { ok: true, condition: { type: 'idle', idleMs } }
  }
  if (condition.type === 'selector') {
    const selector = typeof condition.selector === 'string' ? condition.selector.trim() : ''
    const hasIndex = typeof condition.elementIndex === 'number' && Number.isInteger(condition.elementIndex)
    const hasToken = typeof condition.elementToken === 'string' && condition.elementToken.length > 0
    if (!selector && !hasIndex && !hasToken) {
      return { ok: false, error: 'selector watch requires selector or a snapshot element target' }
    }
    if (selector && (hasIndex || hasToken || typeof condition.snapshotId === 'string')) {
      return { ok: false, error: 'selector watch accepts selector or a snapshot element target, not both' }
    }
    return {
      ok: true,
      condition: {
        type: 'selector',
        selector,
        snapshotId: condition.snapshotId,
        elementIndex: condition.elementIndex,
        elementToken: condition.elementToken,
      },
    }
  }
  if (condition.type === 'url_matches') {
    const pattern = typeof condition.pattern === 'string' ? condition.pattern : ''
    if (!pattern) return { ok: false, error: 'url_matches watch requires pattern' }
    try {
      return { ok: true, condition: { type: 'url_matches', pattern }, urlRegex: new RegExp(pattern) }
    } catch {
      return { ok: false, error: 'url_matches pattern is not a valid regular expression' }
    }
  }
  if (condition.type === 'expression') {
    const expression = typeof condition.expression === 'string' ? condition.expression.trim() : ''
    if (!expression) return { ok: false, error: 'expression watch requires expression' }
    return { ok: true, condition: { type: 'expression', expression } }
  }
  return { ok: false, error: `unsupported watch condition: ${String((condition as { type?: unknown }).type)}` }
}
