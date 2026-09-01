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
