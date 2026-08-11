/**
 * Transcript wording for pi's compaction lifecycle, mirroring the Swift app's
 * `ChatSession.appendSystem` lines (compactionReasonLabel + the three outcomes)
 * so both desktop clients narrate a compaction identically.
 *
 * Pure logic only — no React, no host protocol.
 */

import type { StreamEvent } from '@pipi/host-api'

export type CompactionEvent = Extract<StreamEvent, { type: 'compaction' }>

/** Longest error text kept inline; the rest is dropped rather than flooding the transcript. */
export const COMPACTION_ERROR_MAX_CHARS = 300

/** Mirrors Swift `ChatSession.compactionReasonLabel`; unknown reasons stay unlabelled. */
export function compactionReasonLabel(reason: string | undefined): string {
  switch (reason) {
    case 'manual': return '（手动触发）'
    case 'threshold': return '（上下文超限）'
    case 'overflow': return '（上下文溢出恢复）'
    default: return ''
  }
}

/** The system line for one lifecycle event. */
export function compactionNotice(event: CompactionEvent): string {
  if (event.phase === 'start') return `正在压缩上下文…${compactionReasonLabel(event.reason)}`
  if (event.aborted) return '上下文压缩已取消'
  const error = event.error?.trim()
  if (error) return `上下文压缩失败：${error.slice(0, COMPACTION_ERROR_MAX_CHARS)}`
  return '上下文压缩完成'
}
