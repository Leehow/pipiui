import { useEffect, useState } from 'react'
import type { PipiHostAPI, QuotaSnapshot } from '@pipi/host-api'
import { visibleQuotaWindows } from './QuotaPill'
import './balance-pill.css'

export interface BalancePillProps {
  host: PipiHostAPI
  /** Selected session so the host resolves that session's model provider. */
  sessionId?: string
  /** Current model provider; changing it refetches after an in-session model switch. */
  provider?: string
  /** Extra dependency to force a refetch (e.g. after model/auth changes). */
  refreshKey?: unknown
}

/** Round half away from zero to `digits` decimals (Swift NSDecimalRound .plain). */
function roundHalfAway(value: number, digits: number): number {
  const factor = 10 ** digits
  const scaled = value * factor
  const rounded = scaled >= 0 ? Math.floor(scaled + 0.5) : Math.ceil(scaled - 0.5)
  return rounded / factor
}

/**
 * Formats a prepaid balance for the input-bar capsule, mirroring Swift
 * `formatBalance`: currency symbol + two decimals (`¥110.00` / `$74.75`);
 * unknown currencies fall back to `CURRENCY 110.00`. The body is rendered
 * POSIX-style (`.` separator) exactly like Swift's en_US_POSIX formatter.
 */
export function formatBalance(amount: number, currency: string): string {
  const code = (currency ?? '').toUpperCase()
  const prefix = code === 'CNY' || code === 'RMB' ? '¥' : code === 'USD' ? '$' : code ? `${code} ` : ''
  const body = roundHalfAway(amount, 2).toFixed(2)
  return `${prefix}${body}`
}

/**
 * Swift-style prepaid-balance capsule rendered next to the quota capsule:
 * `¥110.00` / `$74.75` for the selected session's own balance provider.
 * Hidden when the host reports no balance, no snapshot, or subscription-quota
 * windows (quota wins over prepaid balance, Swift parity). The Swift popover
 * spend breakdown is intentionally out of scope for this port.
 */
export function BalancePill({ host, sessionId, provider, refreshKey }: BalancePillProps) {
  const [snapshot, setSnapshot] = useState<QuotaSnapshot | null>(null)

  useEffect(() => {
    if (typeof host.getQuotaSnapshot !== 'function') return
    let cancelled = false
    const load = async () => {
      try {
        const snap = await host.getQuotaSnapshot!(sessionId)
        if (!cancelled) setSnapshot(snap)
      } catch {
        // Balance is best-effort: keep the last good snapshot, never error UI.
      }
    }
    void load()
    return () => { cancelled = true }
  }, [host, sessionId, provider, refreshKey])

  if (!snapshot) return null
  const balance = snapshot.balance
  // Quota wins over balance: a snapshot that reports usage windows never shows
  // the prepaid balance capsule (Swift `bindBalanceMonitor` gate).
  if (!balance || visibleQuotaWindows(snapshot).length > 0) return null
  const text = formatBalance(balance.amount, balance.currency)
  return (
    <span
      className="balance-pill"
      data-testid="balance-pill"
      role="text"
      aria-label={`账户余额 ${text}`}
      title={snapshot.accountLabel || '账户余额'}
    >
      {text}
    </span>
  )
}
