import { useEffect, useMemo, useState } from 'react'
import './waiting-placeholder.css'

/**
 * Waiting phase for the transcript-tail status row.
 *
 * Mirrors Swift `WaitingPlaceholderChoice` (thinking / stopping / compacting /
 * captioning / media) mapped to web equivalents:
 * - `awaiting` — user prompt sent, no visible assistant content yet (first-token wait)
 * - `thinking` — model reasoning in progress (Swift "AI 正在思考…")
 * - `tool`     — a tool run is in flight (Swift media / compacting equivalents)
 * - `retrying` — a failed call is being retried
 * - `stopping` — user requested stop (Swift "正在停止…", which takes precedence)
 */
export type WaitingPhase = 'awaiting' | 'thinking' | 'tool' | 'retrying' | 'stopping'

export const WAITING_COPY = {
  connecting: '正在连接模型',
  readingContext: '模型正在阅读上下文',
  awaitingFirstResponse: '等待第一个响应',
  stillWorking: '模型仍在处理',
  thinking: '模型正在思考…',
  tool: '正在执行工具操作…',
  retrying: '连接中断，正在重试…',
  stopping: '正在停止…'
} as const

/** Elapsed seconds after which the awaiting copy stops implying "connecting". */
export const WAITING_CONNECTED_SECONDS = 1.5
/** Elapsed seconds at which the awaiting copy switches to the neutral "模型仍在处理". */
export const WAITING_LONG_SECONDS = 8
/** Duration of each alternating awaiting copy slot between 1.5s and 8s. */
const WAITING_ROTATE_SLOT_SECONDS = 3

/**
 * Deterministic copy for a phase + elapsed seconds. Pure: no randomness, no
 * Date access — identical inputs always return identical copy, so SSR and
 * tests can pin the output. `awaiting` rotates through fixed time slots
 * (connect → read context / await first response → still working) and never
 * implies the model is stuck.
 */
export function waitingCopy(phase: WaitingPhase, elapsedSeconds: number): string {
  if (phase !== 'awaiting') return WAITING_COPY[phase]
  const t = Math.max(0, elapsedSeconds)
  if (t < WAITING_CONNECTED_SECONDS) return WAITING_COPY.connecting
  if (t < WAITING_LONG_SECONDS) {
    const slot = Math.floor((t - WAITING_CONNECTED_SECONDS) / WAITING_ROTATE_SLOT_SECONDS) % 2
    return slot === 0 ? WAITING_COPY.readingContext : WAITING_COPY.awaitingFirstResponse
  }
  return WAITING_COPY.stillWorking
}

/**
 * Compact wall-clock elapsed label, matching Swift `TurnDurationFormat.elapsed`
 * ("12s", "1min05s", "1h02min03s"). Fractional seconds are truncated.
 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}min${String(s).padStart(2, '0')}s`
  if (m > 0) return `${m}min${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export interface WaitingPlaceholderProps {
  phase: WaitingPhase
  /** Turn-start wall clock (Date or epoch ms); drives the live elapsed readout. */
  startedAt: Date | number
  /** Optional muted context, e.g. the running tool name for phase="tool". */
  detail?: string
  /** Render a keyboard-operable stop control (native button) when provided. */
  onStop?: () => void
  /** Force reduced-motion styling; default follows the CSS `prefers-reduced-motion` media query. */
  reduceMotion?: boolean
}

/** Tick rate for the live elapsed readout (matches Swift TimelineView granularity). */
const TICK_MS = 500

function toEpochMs(startedAt: Date | number): number {
  return startedAt instanceof Date ? startedAt.getTime() : startedAt
}

/**
 * Inline transcript-tail status row shown while an active turn streams but has
 * no visible assistant content yet. Echoes pi's `Working... (esc to interrupt)`
 * and Swift `WaitingPlaceholderView` (small progress indicator + copy +
 * elapsed), rendered as one restrained line: 3-bar waveform · copy · detail ·
 * elapsed · optional stop. Never full-screen, never a skeleton, no big spinner.
 *
 * Integration rule (next round): render it only for the active turn when
 * `streaming && no visible assistant content`; queued follow-ups must not show
 * it. This component makes no global-streaming decisions itself.
 */
export function WaitingPlaceholder({ phase, startedAt, detail, onStop, reduceMotion = false }: WaitingPlaceholderProps) {
  const startMs = useMemo(() => toEpochMs(startedAt), [startedAt])
  const [elapsed, setElapsed] = useState(() => Math.max(0, (Date.now() - startMs) / 1000))

  useEffect(() => {
    // Reset immediately on a new turn (startedAt change), then tick live.
    setElapsed(Math.max(0, (Date.now() - startMs) / 1000))
    const id = window.setInterval(() => setElapsed(Math.max(0, (Date.now() - startMs) / 1000)), TICK_MS)
    return () => window.clearInterval(id)
  }, [startMs])

  const copy = waitingCopy(phase, elapsed)
  const showElapsed = elapsed >= WAITING_CONNECTED_SECONDS
  const className = reduceMotion ? 'waiting-placeholder is-reduce-motion' : 'waiting-placeholder'

  return (
    <div className={className} role="status" aria-live="polite" data-phase={phase} data-testid="waiting-placeholder">
      <span className="waiting-placeholder__bars" aria-hidden="true">
        <span className="waiting-placeholder__bar waiting-placeholder__bar--1" />
        <span className="waiting-placeholder__bar waiting-placeholder__bar--2" />
        <span className="waiting-placeholder__bar waiting-placeholder__bar--3" />
      </span>
      <span className="waiting-placeholder__copy">{copy}</span>
      {detail && (
        <span className="waiting-placeholder__detail" title={detail}>{detail}</span>
      )}
      {showElapsed && (
        <span className="waiting-placeholder__elapsed" data-testid="waiting-elapsed">
          已用时 {formatElapsed(elapsed)}
        </span>
      )}
      {onStop && (
        <button
          type="button"
          className="waiting-placeholder__stop"
          aria-label="停止生成"
          title="停止生成"
          data-testid="waiting-stop"
          onClick={onStop}
        >
          停止
        </button>
      )}
    </div>
  )
}
