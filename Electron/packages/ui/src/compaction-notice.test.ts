import { describe, expect, it } from 'vitest'
import {
  COMPACTION_ERROR_MAX_CHARS,
  compactionNotice,
  compactionPillLabel,
  compactionTriggerLabel,
  compactionTriggerShortLabel,
  resolveCompactionTrigger,
  type CompactionEvent
} from './compaction-notice'

const event = (partial: Partial<CompactionEvent>): CompactionEvent =>
  ({ type: 'compaction', sessionId: 's1', phase: 'start', ...partial }) as CompactionEvent

describe('compactionTriggerLabel', () => {
  it('gives every trigger kind its own user-visible sentence', () => {
    expect(compactionTriggerLabel('manual')).toBe('手动压缩')
    expect(compactionTriggerLabel('proactive_idle')).toBe('空闲自动压缩：上下文≥45%且连续空闲4分钟')
    expect(compactionTriggerLabel('near_overflow')).toBe('临近上下文上限保护')
    expect(compactionTriggerLabel('overflow')).toBe('上下文溢出恢复')
    expect(compactionTriggerLabel('mid_turn')).toBe('回合中工具循环保护')
    expect(compactionTriggerLabel('idle_fold')).toBe('空闲自动折叠')
    expect(compactionTriggerLabel('auto_fold')).toBe('自动折叠')
    // Legacy fallback: no trigger field ⇒ automatic, cause unknown.
    expect(compactionTriggerLabel('auto')).toBe('自动压缩')
  })

  it('keeps a short label for the pill', () => {
    expect(compactionTriggerShortLabel('proactive_idle')).toBe('空闲自动')
    expect(compactionTriggerShortLabel('auto_fold')).toBe('自动折叠')
    expect(compactionTriggerShortLabel('auto')).toBe('自动')
  })
})

describe('resolveCompactionTrigger', () => {
  it('prefers the classified trigger over pi\'s reason', () => {
    // The scheduler's compact RPC arrives as reason=manual; the host's
    // trigger field is what separates it from a user /compact.
    expect(resolveCompactionTrigger(event({ phase: 'end', reason: 'manual', trigger: 'proactive_idle' }))).toBe('proactive_idle')
    expect(resolveCompactionTrigger(event({ reason: 'threshold', trigger: 'mid_turn' }))).toBe('mid_turn')
  })

  it('falls back to reason for legacy events, 自动 for the rest', () => {
    expect(resolveCompactionTrigger(event({ reason: 'manual' }))).toBe('manual')
    expect(resolveCompactionTrigger(event({ reason: 'overflow' }))).toBe('overflow')
    // A legacy threshold event could be any of several mechanisms: keep the
    // explicit 自动 fallback rather than guessing one mechanism.
    expect(resolveCompactionTrigger(event({ reason: 'threshold' }))).toBe('auto')
    expect(resolveCompactionTrigger(event({}))).toBe('auto')
  })
})

describe('compactionNotice', () => {
  it('narrates the start with its trigger', () => {
    expect(compactionNotice(event({ phase: 'start', trigger: 'near_overflow' }))).toBe('正在压缩上下文…（临近上下文上限保护）')
    expect(compactionNotice(event({ phase: 'start' }))).toBe('正在压缩上下文…（自动压缩）')
  })

  it('names the concrete trigger on completion', () => {
    expect(compactionNotice(event({ phase: 'end', trigger: 'manual' }))).toBe('上下文压缩完成（手动压缩）')
    expect(compactionNotice(event({ phase: 'end', reason: 'manual', trigger: 'proactive_idle' }))).toBe('上下文压缩完成（空闲自动压缩：上下文≥45%且连续空闲4分钟）')
    expect(compactionNotice(event({ phase: 'end', trigger: 'mid_turn' }))).toBe('上下文压缩完成（回合中工具循环保护）')
    expect(compactionNotice(event({ phase: 'end', trigger: 'overflow' }))).toBe('上下文压缩完成（上下文溢出恢复）')
    expect(compactionNotice(event({ phase: 'end', reason: 'threshold' }))).toBe('上下文压缩完成（自动压缩）')
  })

  it('distinguishes success, abort and failure', () => {
    expect(compactionNotice(event({ phase: 'end', trigger: 'manual', aborted: true }))).toBe('上下文压缩已取消（手动压缩）')
    expect(compactionNotice(event({ phase: 'end', error: 'summarizer timed out' }))).toBe('上下文压缩失败：summarizer timed out')
  })

  it('bounds a runaway error instead of flooding the transcript', () => {
    const notice = compactionNotice(event({ phase: 'end', error: 'x'.repeat(1_000) }))
    expect(notice).toBe(`上下文压缩失败：${'x'.repeat(COMPACTION_ERROR_MAX_CHARS)}`)
  })

  it('never says 已压缩 for notice-only (check/nudge/skip) events', () => {
    const notice = compactionNotice(event({ phase: 'end', executed: false, skipReason: '上下文低于45%' }))
    expect(notice).toContain('未执行压缩')
    expect(notice).not.toContain('已压缩')
    expect(notice).toContain('上下文低于45%')
    expect(compactionNotice(event({ phase: 'end', executed: false }))).toBe('已检查压缩条件，未执行压缩（条件不满足）')
  })

  it('labels a deterministic idle fold as 整理, never 压缩', () => {
    expect(compactionNotice(event({ phase: 'end', operation: 'context_fold', trigger: 'idle_fold', executed: true })))
      .toBe('上下文已折叠整理（空闲自动折叠）')
    expect(compactionNotice(event({ phase: 'start', operation: 'context_fold', trigger: 'idle_fold', executed: true })))
      .toBe('正在整理上下文…（空闲自动折叠）')
    const fold = compactionNotice(event({ phase: 'end', operation: 'context_fold', trigger: 'idle_fold', executed: true }))
    expect(fold).not.toContain('压缩')
  })

  it('labels a fold with an unconfirmed trigger as 自动折叠, still never 压缩', () => {
    const notice = compactionNotice(event({ phase: 'end', operation: 'context_fold', trigger: 'auto_fold', executed: true }))
    expect(notice).toBe('上下文已折叠整理（自动折叠）')
    expect(notice).not.toContain('压缩')
    expect(resolveCompactionTrigger(event({ phase: 'end', operation: 'context_fold', trigger: 'auto_fold' }))).toBe('auto_fold')
  })
})

describe('compactionPillLabel', () => {
  it('names the concrete operation in the pill', () => {
    expect(compactionPillLabel(event({ phase: 'start', trigger: 'proactive_idle' }))).toBe('压缩中（空闲自动）')
    expect(compactionPillLabel(event({ phase: 'start', trigger: 'mid_turn' }))).toBe('压缩中（回合中保护）')
    expect(compactionPillLabel(event({ phase: 'start', operation: 'context_fold', trigger: 'idle_fold' }))).toBe('整理上下文中…')
  })

  it('covers every trigger kind', () => {
    const kinds = ['manual', 'proactive_idle', 'near_overflow', 'overflow', 'mid_turn', 'idle_fold'] as const
    for (const kind of kinds) {
      const label = compactionPillLabel(event({ phase: 'start', trigger: kind }))
      expect(label.length).toBeGreaterThan(0)
      expect(label).toContain('压缩中')
    }
    // Legacy event with no trigger field: automatic fallback.
    expect(compactionPillLabel(event({ phase: 'start' }))).toBe('压缩中（自动）')
  })
})
