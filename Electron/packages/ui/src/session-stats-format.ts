/**
 * Pure formatting helpers for the session-stats pill / popover.
 *
 * Preserves the existing PipiUI token, pricing, and performance formatting
 * formatTokensPerSecond) so the Electron UI and the macOS app render
 * identical numbers. All functions are deterministic and locale-independent.
 */

export type CostDisplayUnit = 'USD' | 'CNY'

/** Round half to even, matching Swift's `String(format:)`/`.rounded()`. Inputs are non-negative. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x)
  const frac = x - floor
  if (frac < 0.5) return floor
  if (frac > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Compact token counts: `0`, `999`, `1.2k`, `10k`, `60k`, `200k`, `1.5m`.
 * Mirrors Swift `TokenFormat.compact` including its quirk that scaled values
 * ≥ 10 lose the decimal (`26400 → "26k"`, `999999 → "1000k"`).
 */
export function formatCompactTokens(value: number): string {
  const truncated = Math.trunc(value)
  const absValue = Math.abs(truncated)
  const sign = truncated < 0 ? '-' : ''
  if (absValue >= 1_000_000) {
    return `${sign}${trimDecimal(absValue / 1_000_000)}m`
  }
  if (absValue >= 1_000) {
    return `${sign}${trimDecimal(absValue / 1_000)}k`
  }
  return `${truncated}`
}

/** `1.2` / `10` / `1.5` — 1 decimal below 10, integer from 10 up, trailing `.0` stripped. */
function trimDecimal(scaled: number): string {
  if (scaled >= 10) {
    return String(roundHalfEven(scaled))
  }
  const oneDecimal = (roundHalfEven(scaled * 10) / 10).toFixed(1)
  return oneDecimal.endsWith('.0') ? oneDecimal.slice(0, -2) : oneDecimal
}

/** `Int(percent.rounded())` — `24.6 → "25%"`, `80.4 → "80%"`. */
export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

/**
 * Cache hit rate per spec: `cacheRead / (input + cacheRead)`.
 * Returns null when the denominator is 0 — the UI renders "—".
 * (Swift's InputBar additionally folds cacheWrite into the denominator; the
 * spec formula deliberately leaves it out.)
 */
export function cacheHitRate(cacheRead: number, input: number): string | null {
  const denominator = input + cacheRead
  if (denominator <= 0) return null
  return formatPercent((cacheRead / denominator) * 100)
}

/**
 * Adaptive-precision cost display mirroring Swift formatUSD/formatCNY:
 * 0 → `$0`/`¥0`; < 0.01 → 4 decimals; < 1 → 3 decimals; else 2 decimals.
 * The host reports cost in USD; CNY is derived via the exchange rate and only
 * when a positive rate is supplied — otherwise it falls back to USD rather
 * than fabricate a conversion.
 */
export function formatCost(usdCost: number, unit: CostDisplayUnit = 'USD', exchangeRate?: number): string {
  const cny = unit === 'CNY' && exchangeRate !== undefined && exchangeRate > 0
  const amount = cny ? usdCost * exchangeRate : usdCost
  const symbol = cny ? '¥' : '$'
  if (amount <= 0) return `${symbol}0`
  if (amount < 0.01) return `${symbol}${amount.toFixed(4)}`
  if (amount < 1) return `${symbol}${amount.toFixed(3)}`
  return `${symbol}${amount.toFixed(2)}`
}

/**
 * Average first-token latency. The host reports milliseconds; Swift stores
 * seconds, so this converts first: `830ms → "0.83s"`, `12.5s → "12.5s"`.
 */
export function formatTTFT(ttftMs: number): string {
  const seconds = ttftMs / 1000
  const formatted = seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)
  return `${formatted}s`
}

/** `42.46 → "42.5 tok/s"` — always 1 decimal, matching Swift. */
export function formatTokensPerSecond(tokensPerSecond: number): string {
  return `${tokensPerSecond.toFixed(1)} tok/s`
}

/**
 * Context-window occupancy, clamped to 0–100. Prefers the host-reported
 * percent and derives it from tokens/window only when the host omitted it
 * (e.g. right after compaction, where `tokens`/`percent` are null).
 */
export function contextPercent(tokens: number | null, window: number, reportedPercent: number | null): number | null {
  if (reportedPercent !== null && reportedPercent !== undefined) {
    return Math.min(100, Math.max(0, reportedPercent))
  }
  if (tokens !== null && tokens !== undefined && window > 0) {
    return Math.min(100, Math.max(0, (tokens / window) * 100))
  }
  return null
}
