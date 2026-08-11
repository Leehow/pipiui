import { useEffect, useRef, useState } from 'react'
import type { PipiHostAPI, SessionPerformance, SessionStats } from '@pipi/host-api'
import { useSessionStats } from './useSessionStats'
import {
  cacheHitRate,
  contextPercent,
  formatCompactTokens,
  formatCost,
  formatPercent,
  formatTokensPerSecond,
  formatTTFT,
  type CostDisplayUnit
} from './session-stats-format'
import './session-stats-pill.css'

export interface SessionStatsPillProps {
  host: PipiHostAPI
  /** Omit to target the host's current active session. */
  sessionId?: string
  /** Streaming status: shows a compact "生成中…" indicator next to the pill. */
  isStreaming?: boolean
  /**
   * Context compaction is running (pi's own threshold/overflow path, the host's
   * idle-time one, or `/compact`). Shows a "压缩中…" indicator; it takes over the
   * slot because a compaction never overlaps a streaming turn.
   */
  isCompacting?: boolean
  /** Display unit for the cost row. The host reports USD; CNY needs exchangeRate. */
  costUnit?: CostDisplayUnit
  /** USD→CNY rate; required to render CNY, otherwise cost falls back to USD. */
  exchangeRate?: number
  /** Changes after a stream settles to force one authoritative host snapshot. */
  refreshKey?: unknown
}

/** True when the host actually reported at least one performance field — never guessed. */
function hasPerformance(performance: SessionPerformance | undefined): boolean {
  return performance !== undefined && (
    performance.ttftMs !== undefined ||
    performance.tokensPerSecond !== undefined ||
    performance.sampleCount !== undefined
  )
}

/**
 * Compact bottom-bar capsule with the session's context-window usage and a
 * popover (positioned above the pill) with the full per-session accounting.
 *
 * Mount point (next integration step, e.g. inside the composer's bottom row):
 * ```tsx
 * <SessionStatsPill host={host} sessionId={selectedSession} isStreaming={streaming} costUnit="USD" exchangeRate={7.2} />
 * ```
 * Light/dark styling is fully self-contained in session-stats-pill.css.
 */
export function SessionStatsPill({ host, sessionId, isStreaming = false, isCompacting = false, costUnit = 'USD', exchangeRate, refreshKey }: SessionStatsPillProps) {
  const { stats, status, error, retry } = useSessionStats(host, sessionId, refreshKey)
  const [open, setOpen] = useState(false)
  const [errorDismissed, setErrorDismissed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setErrorDismissed(false) }, [sessionId, refreshKey])

  // Close the popover on Esc or any outside pointer-down while it is open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  if (status === 'loading') {
    return (
      <div className="session-stats-pill" data-testid="stats-loading" aria-busy="true">
        <span className="session-stats-pill__chip" aria-label="正在加载会话统计">…</span>
      </div>
    )
  }

  if (status === 'error' || !stats) {
    if (errorDismissed) return null
    return (
      <div className="session-stats-pill" data-testid="stats-unavailable">
        <button
          type="button"
          className="session-stats-pill__chip session-stats-pill__chip--error"
          data-testid="stats-error"
          title={error}
          aria-label="重试加载会话统计"
          onClick={retry}
        >
          统计不可用
        </button>
        <button type="button" className="session-stats-pill__dismiss" aria-label="关闭会话统计不可用提示" onClick={() => setErrorDismissed(true)}>×</button>
      </div>
    )
  }

  const ctx = stats.contextUsage
  const tokens = ctx?.tokens ?? null
  const windowSize = ctx?.contextWindow ?? 0
  const reportedPercent = ctx?.percent ?? null
  const pct = contextPercent(tokens, windowSize, reportedPercent)
  const ring = tokens !== null && windowSize > 0 ? Math.min(1, Math.max(0, tokens / windowSize)) : null
  const hot = (ring ?? 0) > 0.8

  let pillText: string | null = null
  if (tokens !== null && windowSize > 0) {
    pillText = `${formatCompactTokens(tokens)}/${formatCompactTokens(windowSize)}`
  } else if (windowSize > 0) {
    // Match Swift TokenFormat.contextStatus: a known window with unknown usage
    // is `?/200k`, not a guessed percentage or cumulative-token fallback.
    pillText = `?/${formatCompactTokens(windowSize)}`
  } else if (tokens !== null) {
    pillText = formatCompactTokens(tokens)
  } else if (reportedPercent !== null) {
    pillText = formatPercent(reportedPercent)
  }
  // Swift leaves this slot empty when pi has not reported any context facts;
  // session-total tokens are not a substitute for context-window usage.
  if (pillText === null) return null

  const modelName = stats.model?.name || stats.model?.id
  const hitRate = cacheHitRate(stats.tokens.cacheRead, stats.tokens.input)
  const performance = hasPerformance(stats.performance) ? stats.performance : undefined

  return (
    <div className="session-stats-pill" ref={rootRef}>
      {isCompacting ? (
        <span className="session-stats-pill__streaming" data-testid="stats-compacting" aria-label="正在压缩上下文">
          <span className="session-stats-pill__streaming-dot" aria-hidden="true" />
          压缩中…
        </span>
      ) : isStreaming && (
        <span className="session-stats-pill__streaming" data-testid="stats-streaming" aria-label="生成中">
          <span className="session-stats-pill__streaming-dot" aria-hidden="true" />
          生成中…
        </span>
      )}
      <button
        type="button"
        className="session-stats-pill__toggle"
        data-testid="stats-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {ring !== null && (
          <svg className="session-stats-pill__ring" data-testid="context-progress-ring" viewBox="0 0 14 14" aria-hidden="true">
            <circle className="session-stats-pill__ring-track" cx="7" cy="7" r="5.75" fill="none" strokeWidth="2.5" />
            <circle
              className={hot ? 'session-stats-pill__ring-fill is-hot' : 'session-stats-pill__ring-fill'}
              cx="7" cy="7" r="5.75" fill="none" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={`${ring * 36.13} 36.13`}
              transform="rotate(-90 7 7)"
            />
          </svg>
        )}
        <span className="session-stats-pill__toggle-text">{pillText}</span>
      </button>

      {open && (
        <div className="session-stats-pill__popover" role="dialog" aria-label="上下文占用统计" data-testid="stats-popover">
          <h2 className="session-stats-pill__title">上下文占用</h2>
          {pct !== null && tokens !== null && windowSize > 0 ? (
            <>
              <div className="session-stats-pill__usage-row">
                <span className="session-stats-pill__usage-text">{formatCompactTokens(tokens)} / {formatCompactTokens(windowSize)}</span>
                <span className={hot ? 'session-stats-pill__usage-percent is-hot' : 'session-stats-pill__usage-percent'}>{formatPercent(pct)}</span>
              </div>
              <div
                className="session-stats-pill__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                aria-label="上下文占用百分比"
              >
                <div className={hot ? 'session-stats-pill__bar-fill is-hot' : 'session-stats-pill__bar-fill'} style={{ width: `${pct}%` }} />
              </div>
            </>
          ) : (
            <p className="session-stats-pill__hint">暂无上下文数据</p>
          )}

          <hr className="session-stats-pill__divider" />
          <h3 className="session-stats-pill__section">本次会话</h3>
          <dl className="session-stats-pill__rows">
            <div className="session-stats-pill__row"><dt>输入</dt><dd data-testid="stats-input">{formatCompactTokens(stats.tokens.input)}</dd></div>
            <div className="session-stats-pill__row"><dt>输出</dt><dd data-testid="stats-output">{formatCompactTokens(stats.tokens.output)}</dd></div>
            <div className="session-stats-pill__row"><dt>缓存读取</dt><dd data-testid="stats-cache-read">{formatCompactTokens(stats.tokens.cacheRead)}</dd></div>
            <div className="session-stats-pill__row"><dt>缓存命中率</dt><dd data-testid="stats-cache-hit">{hitRate ?? '—'}</dd></div>
            <div className="session-stats-pill__row"><dt>累计花费</dt><dd data-testid="stats-cost">{formatCost(stats.cost, costUnit, exchangeRate)}</dd></div>
            {modelName && <div className="session-stats-pill__row"><dt>当前模型</dt><dd data-testid="stats-model">{modelName}</dd></div>}
          </dl>

          {performance && (
            <>
              <hr className="session-stats-pill__divider" />
              <h3 className="session-stats-pill__section">生成性能</h3>
              <dl className="session-stats-pill__rows">
                {performance.sampleCount !== undefined && (
                  <div className="session-stats-pill__row"><dt>采样次数</dt><dd data-testid="stats-samples">{performance.sampleCount} 次采样</dd></div>
                )}
                {performance.ttftMs !== undefined && (
                  <div className="session-stats-pill__row"><dt>平均首字</dt><dd data-testid="stats-ttft">{formatTTFT(performance.ttftMs)}</dd></div>
                )}
                {performance.tokensPerSecond !== undefined && (
                  <div className="session-stats-pill__row"><dt>生成速度</dt><dd data-testid="stats-tps">{formatTokensPerSecond(performance.tokensPerSecond)}</dd></div>
                )}
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  )
}
