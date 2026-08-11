import { useEffect, useState } from 'react'
import type { PipiHostAPI, SessionStats, SessionStatsEvent } from '@pipi/host-api'

export type SessionStatsStatus = 'loading' | 'ready' | 'error'

/**
 * Automatic retries after a transient fetch failure (cold-start lease races,
 * pi still spawning): each failed attempt is retried with the next backoff
 * delay before the error state is surfaced. The manual `retry()` remains as a
 * last resort for persistent failures.
 */
const AUTO_RETRIES = 2
const AUTO_RETRY_DELAYS = [300, 1000]

export interface UseSessionStatsResult {
  /** Latest snapshot; null until the first get/push resolves. */
  stats: SessionStats | null
  status: SessionStatsStatus
  /** Human-readable message when status is 'error'. */
  error?: string
  /** Re-run the initial fetch after a failure (no polling). */
  retry: () => void
}

/**
 * Preserve a previously reported context window when pi omits usage from a
 * later snapshot (notably after compaction). The new token count is unknown,
 * not the previous count, so the UI can render Swift's `?/200k` form.
 */
export function mergeSessionStats(previous: SessionStats | null, incoming: SessionStats): SessionStats {
  const previousWindow = previous?.contextUsage?.contextWindow
  const incomingUsage = incoming.contextUsage
  if (typeof previousWindow !== 'number' || previousWindow <= 0) return incoming

  const incomingWindow = incomingUsage?.contextWindow
  if (typeof incomingWindow === 'number' && incomingWindow > 0) return incoming

  return {
    ...incoming,
    contextUsage: {
      tokens: incomingUsage?.tokens ?? null,
      contextWindow: previousWindow,
      percent: incomingUsage?.percent ?? null
    }
  }
}

/**
 * Live session stats without polling:
 *  1. one `getSessionStats(sessionId)` on mount / sessionId change;
 *  2. `session_stats` pushes refresh the snapshot as they arrive;
 *  3. switching `sessionId` tears down the old subscription and refetches;
 *  4. transient failures (e.g. a cold-start lease race) are retried with
 *     backoff before surfacing as `status: 'error'` with `retry()`.
 *
 * With `sessionId` omitted, `getSessionStats()` targets the host's current
 * active session and pushes are accepted for any session (the host only
 * publishes the active session).
 */
export function useSessionStats(host: PipiHostAPI, sessionId?: string, refreshKey?: unknown): UseSessionStatsResult {
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [status, setStatus] = useState<SessionStatsStatus>('loading')
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    setStats(null)
    setError(undefined)
    setStatus('loading')

    const fetchStats = async (retriesLeft = AUTO_RETRIES) => {
      try {
        if (typeof host.getSessionStats !== 'function') {
          throw new Error('宿主未提供 getSessionStats')
        }
        const snapshot = await host.getSessionStats(sessionId)
        if (cancelled) return
        setStats(previous => mergeSessionStats(previous, snapshot))
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        if (retriesLeft > 0) {
          const delayMs = AUTO_RETRY_DELAYS[AUTO_RETRIES - retriesLeft] ?? 0
          await new Promise(resolve => setTimeout(resolve, delayMs))
          if (cancelled) return
          await fetchStats(retriesLeft - 1)
          return
        }
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    }
    void fetchStats()

    if (typeof host.subscribeSessionStats === 'function') {
      unsubscribe = host.subscribeSessionStats((event: SessionStatsEvent) => {
        if (cancelled) return
        if (sessionId !== undefined && event.sessionId !== sessionId) return
        setStats(previous => mergeSessionStats(previous, event.stats))
        setError(undefined)
        setStatus('ready')
      })
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [host, sessionId, attempt, refreshKey])

  return { stats, status, error, retry: () => setAttempt(a => a + 1) }
}
