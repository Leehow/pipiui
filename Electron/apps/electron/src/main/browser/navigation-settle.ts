import type { BrowserViewLike, ViewPane } from './types.js'

/** Bound for loadURL / reload settle waits: a hung Chromium commit must not pin the caller or the session action queue. */
export const BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS = 10_000
/** Alias kept for reload() call sites and existing tests. */
export const BROWSER_RELOAD_SETTLE_TIMEOUT_MS = BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS
const BROWSER_NAVIGATION_SETTLE_POLL_HINT_MS = 50

/**
 * Await Electron `webContents.loadURL()`, which resolves on did-finish-load.
 * If that never comes, resolve `'timedOut'` at the bound so showPane / tool
 * navigate (and the per-session action queue sitting behind them) can continue.
 * A rejection that lands before the bound still rejects; a late failure after
 * timeout is swallowed so it cannot become an unhandled rejection.
 */
export function awaitLoadURL(
  load: Promise<unknown>,
  timeoutMs: number = BROWSER_NAVIGATION_SETTLE_TIMEOUT_MS,
): Promise<'loaded' | 'timedOut'> {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (action: () => void) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      action()
    }
    const timer = setTimeout(() => finish(() => resolve('timedOut')), timeoutMs)
    Promise.resolve(load).then(
      () => finish(() => resolve('loaded')),
      (error: unknown) => {
        if (finished) return
        finish(() => reject(error))
      },
    )
  })
}

/**
 * Bound for one page evaluate.
 *
 * `webContents.executeJavaScript()` has no deadline of its own, and there are several
 * ordinary ways for it never to settle: a renderer blocked by a native dialog (the
 * in-page dialog suppressor is best-effort and misses anything fired before it installs
 * or from a cross-origin frame), a long synchronous script, a target torn down mid-call.
 * Every one of those used to pin the awaiting action, and with it the whole per-session
 * action queue behind it — the same failure `awaitLoadURL` above was written for, on the
 * other half of the same host.
 */
export const BROWSER_PAGE_EVALUATE_TIMEOUT_MS = 15_000

export class BrowserPageUnresponsiveError extends Error {
  readonly code = 'page_unresponsive'
  constructor(timeoutMs: number) {
    super(
      `browser page did not answer within ${timeoutMs}ms; the renderer is blocked (a dialog, a long synchronous script, or a torn-down target). Navigate or reload the page before retrying this action.`,
    )
    this.name = 'BrowserPageUnresponsiveError'
  }
}

/**
 * Race a page evaluate against its bound. A late settle after the bound is swallowed
 * rather than becoming an unhandled rejection, exactly like `awaitLoadURL`.
 */
export function awaitPageEvaluate<T>(
  work: Promise<T>,
  timeoutMs: number = BROWSER_PAGE_EVALUATE_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false
    const finish = (action: () => void) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      action()
    }
    const timer = setTimeout(() => finish(() => reject(new BrowserPageUnresponsiveError(timeoutMs))), timeoutMs)
    Promise.resolve(work).then(
      value => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

/**
 * Ceiling after which the per-session action queue moves on without its head.
 *
 * Every browser operation is individually bounded, so this only fires if one of those
 * bounds is ever missed or a new unbounded path is added. It is deliberately far larger
 * than any single operation's own budget: it is a backstop against a permanently pinned
 * session, not a second deadline competing with the real ones.
 */
export const BROWSER_SESSION_QUEUE_CEILING_MS = 90_000

/**
 * Advance a session queue tail once its operation settles, or at the ceiling — whichever
 * comes first. The operation's own promise is unaffected; the caller still awaits the real
 * result. A late settle is swallowed so it cannot surface as an unhandled rejection.
 */
export function advanceQueueTail(
  operation: Promise<unknown>,
  ceilingMs: number = BROWSER_SESSION_QUEUE_CEILING_MS,
): Promise<void> {
  return new Promise<void>(resolve => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, ceilingMs)
    timer.unref?.()
    operation.then(finish, finish)
  })
}

/**
 * Navigation settle coordination for the promise-less native reload(): waits
 * are woken when a pane's in-flight navigation clears (stop/fail) or the pane
 * retires, with a failsafe poll plus an absolute ceiling.
 */
export class NavigationSettle {
  /** Reload() settle waits, woken when a pane's in-flight navigation clears (stop/fail) or the pane retires. */
  private readonly waiters = new Map<ViewPane, Set<() => void>>()

  /** Wake reload() settle waits: the pane's pending navigation has cleared or failed. */
  notify(pane: ViewPane): void {
    const waiters = this.waiters.get(pane)
    if (!waiters?.size) return
    this.waiters.delete(pane)
    waiters.forEach(resolve => resolve())
  }

  /**
   * Await one pane's navigation lifecycle for the promise-less native reload().
   * Resolves when the pending navigation clears (did-stop-loading / did-fail-load
   * both funnel through setLoading(false)), the pane's view is retired, or the
   * bound budget expires — a hung commit must not pin the caller forever.
   */
  waitFor(pane: ViewPane, view: BrowserViewLike, timeoutMs: number): Promise<void> {
    if (pane.view !== view || !pane.pending) return Promise.resolve()
    return new Promise<void>(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        this.waiters.get(pane)?.delete(finish)
        clearInterval(poll)
        clearTimeout(timer)
        resolve()
      }
      // Failsafe poll: the notify path covers known lifecycle events; the poll
      // bounds the wait if a clearing path ever misses the notification.
      const poll = setInterval(() => {
        if (pane.view !== view || !pane.pending) finish()
      }, BROWSER_NAVIGATION_SETTLE_POLL_HINT_MS)
      const timer = setTimeout(finish, timeoutMs)
      const waiters = this.waiters.get(pane) ?? new Set()
      this.waiters.set(pane, waiters)
      waiters.add(finish)
    })
  }
}
