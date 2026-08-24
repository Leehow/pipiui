/**
 * Transcript wording for pi's compaction lifecycle, mirroring the Swift app's
 * `ChatSession.appendSystem` lines (compactionReasonLabel + the three outcomes)
 * so both desktop clients narrate a compaction identically.
 *
 * Classification wording lives here too: a compaction notice must name its
 * operation and trigger so a manual `/compact`, the idle scheduler, near-overflow
 * protection, overflow recovery, a mid-turn guard compaction, and a
 * deterministic idle fold never read as the same generic “压缩”.
 *
 * Pure logic only — no React, no host protocol.
 */

import type { StreamEvent } from '@pipi/host-api'

export type CompactionEvent = Extract<StreamEvent, { type: 'compaction' }>

/** The trigger kinds the host protocol distinguishes; `auto` is the legacy fallback. */
export type CompactionTriggerKind =
  | 'manual'
  | 'proactive_idle'
  | 'near_overflow'
  | 'overflow'
  | 'mid_turn'
  | 'idle_fold'
  | 'auto_fold'
  | 'auto'

/** Longest error text kept inline; the rest is dropped rather than flooding the transcript. */
export const COMPACTION_ERROR_MAX_CHARS = 300

/**
 * The effective trigger of one event. Events from a newer host carry `trigger`;
 * legacy events only have pi's `reason` (manual/overflow stay readable from it,
 * everything else falls back to `auto` = 自动压缩/未知触发).
 */
export function resolveCompactionTrigger(event: CompactionEvent): CompactionTriggerKind {
  if (event.trigger) return event.trigger
  if (event.reason === 'manual') return 'manual'
  if (event.reason === 'overflow') return 'overflow'
  return 'auto'
}

/** Short label naming why this ran; every kind has its own user-visible sentence. */
export function compactionTriggerLabel(trigger: CompactionTriggerKind): string {
  switch (trigger) {
    case 'manual': return '手动压缩'
    case 'proactive_idle': return '空闲自动压缩：上下文≥45%且连续空闲4分钟'
    case 'near_overflow': return '临近上下文上限保护'
    case 'overflow': return '上下文溢出恢复'
    case 'mid_turn': return '回合中工具循环保护'
    case 'idle_fold': return '空闲自动折叠'
    case 'auto_fold': return '自动折叠'
    default: return '自动压缩'
  }
}

/** Compact trigger label for the stats pill's one-line indicator. */
export function compactionTriggerShortLabel(trigger: CompactionTriggerKind): string {
  switch (trigger) {
    case 'manual': return '手动'
    case 'proactive_idle': return '空闲自动'
    case 'near_overflow': return '临近上限'
    case 'overflow': return '溢出恢复'
    case 'mid_turn': return '回合中保护'
    case 'idle_fold': return '空闲折叠'
    case 'auto_fold': return '自动折叠'
    default: return '自动'
  }
}

/** The system line for one lifecycle event. */
export function compactionNotice(event: CompactionEvent): string {
  const trigger = resolveCompactionTrigger(event)
  const label = compactionTriggerLabel(trigger)
  // Notice-only events (check / idle-fold nudge / skip) never ran anything and
  // must never read as “已压缩”.
  if (event.executed === false) {
    return `已检查压缩条件，未执行压缩（${event.skipReason?.trim() || '条件不满足'}）`
  }
  if (event.operation === 'context_fold') {
    if (event.phase === 'start') return `正在整理上下文…（${label}）`
    if (event.aborted) return '上下文整理已取消'
    const error = event.error?.trim()
    if (error) return `上下文整理失败：${error.slice(0, COMPACTION_ERROR_MAX_CHARS)}`
    return `上下文已折叠整理（${label}）`
  }
  if (event.phase === 'start') return `正在压缩上下文…（${label}）`
  if (event.aborted) return `上下文压缩已取消（${label}）`
  const error = event.error?.trim()
  if (error) return `上下文压缩失败：${error.slice(0, COMPACTION_ERROR_MAX_CHARS)}`
  return `上下文压缩完成（${label}）`
}

/** Pill label while a compaction is running; names the concrete operation. */
export function compactionPillLabel(event: CompactionEvent): string {
  if (event.operation === 'context_fold') return '整理上下文中…'
  return `压缩中（${compactionTriggerShortLabel(resolveCompactionTrigger(event))}）`
}
