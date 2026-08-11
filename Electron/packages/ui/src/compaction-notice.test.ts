import { describe, expect, it } from 'vitest'
import { COMPACTION_ERROR_MAX_CHARS, compactionNotice, compactionReasonLabel, type CompactionEvent } from './compaction-notice'

const event = (partial: Partial<CompactionEvent>): CompactionEvent =>
  ({ type: 'compaction', sessionId: 's1', phase: 'start', ...partial }) as CompactionEvent

describe('compactionReasonLabel', () => {
  it('labels pi\'s three reasons and leaves anything else unlabelled', () => {
    expect(compactionReasonLabel('manual')).toBe('（手动触发）')
    expect(compactionReasonLabel('threshold')).toBe('（上下文超限）')
    expect(compactionReasonLabel('overflow')).toBe('（上下文溢出恢复）')
    expect(compactionReasonLabel(undefined)).toBe('')
    expect(compactionReasonLabel('something-new')).toBe('')
  })
})

describe('compactionNotice', () => {
  it('narrates the start with its reason', () => {
    expect(compactionNotice(event({ phase: 'start', reason: 'threshold' }))).toBe('正在压缩上下文…（上下文超限）')
    expect(compactionNotice(event({ phase: 'start' }))).toBe('正在压缩上下文…')
  })

  it('distinguishes success, abort and failure', () => {
    expect(compactionNotice(event({ phase: 'end', reason: 'manual' }))).toBe('上下文压缩完成')
    expect(compactionNotice(event({ phase: 'end', aborted: true }))).toBe('上下文压缩已取消')
    expect(compactionNotice(event({ phase: 'end', error: 'summarizer timed out' }))).toBe('上下文压缩失败：summarizer timed out')
  })

  it('bounds a runaway error instead of flooding the transcript', () => {
    const notice = compactionNotice(event({ phase: 'end', error: 'x'.repeat(1_000) }))
    expect(notice).toBe(`上下文压缩失败：${'x'.repeat(COMPACTION_ERROR_MAX_CHARS)}`)
  })
})
