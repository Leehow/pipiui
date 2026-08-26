import type { BrowserViewLike, ViewPane } from './types.js'

/** Bound for the reload() settle wait: native reload() has no promise, so the lifecycle completion is awaited via pane state with this ceiling. */
export const BROWSER_RELOAD_SETTLE_TIMEOUT_MS = 10_000
const BROWSER_NAVIGATION_SETTLE_POLL_HINT_MS = 50

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
