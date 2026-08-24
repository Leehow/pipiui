import { describe, expect, it } from 'vitest'
import type { StreamEvent } from '../src/index.js'

/**
 * Compaction event protocol surface: the classification fields are optional
 * additions to the legacy `{ type, sessionId, phase, reason, aborted, error }`
 * shape, so an older renderer keeps working and a newer renderer survives an
 * older host. These tests pin the wire shape both ways.
 */

type CompactionEvent = Extract<StreamEvent, { type: 'compaction' }>

const compaction = (event: CompactionEvent): CompactionEvent => event

describe('compaction event protocol', () => {
  it('expresses all seven trigger kinds plus the two operations', () => {
    const triggers = [
      'manual',
      'proactive_idle',
      'near_overflow',
      'overflow',
      'mid_turn',
      'idle_fold',
      'auto_fold'
    ] as const
    for (const trigger of triggers) {
      const start = compaction({ type: 'compaction', sessionId: 's1', phase: 'start', reason: 'threshold', operation: 'context_compaction', trigger, executed: true })
      expect(start.trigger).toBe(trigger)
      expect(start.operation).toBe('context_compaction')
      expect(start.executed).toBe(true)
    }
    const fold = compaction({ type: 'compaction', sessionId: 's1', phase: 'end', operation: 'context_fold', trigger: 'idle_fold', executed: true })
    expect(fold.operation).toBe('context_fold')
  })

  it('keeps the legacy shape wire-compatible in both directions', () => {
    // Legacy host → new renderer: no classification fields at all.
    const legacy: CompactionEvent = compaction({ type: 'compaction', sessionId: 's1', phase: 'end', reason: 'threshold', aborted: undefined, error: undefined })
    expect(legacy.trigger).toBeUndefined()
    expect(legacy.operation).toBeUndefined()
    expect(legacy.executed).toBeUndefined()
    // New host → legacy renderer: the old fields are unchanged and JSON round-trips.
    const modern = compaction({ type: 'compaction', sessionId: 's1', phase: 'end', reason: 'manual', operation: 'context_compaction', trigger: 'proactive_idle', executed: true })
    const round = JSON.parse(JSON.stringify(modern)) as CompactionEvent
    expect(round.type).toBe('compaction')
    expect(round.phase).toBe('end')
    expect(round.reason).toBe('manual')
    expect(round.trigger).toBe('proactive_idle')
  })

  it('distinguishes notice-only events from executed lifecycles', () => {
    const check = compaction({ type: 'compaction', sessionId: 's1', phase: 'end', executed: false, skipReason: '上下文低于45%' })
    expect(check.executed).toBe(false)
    expect(check.skipReason).toBe('上下文低于45%')
    // A real lifecycle event stays executed: true even when aborted or failed.
    const aborted = compaction({ type: 'compaction', sessionId: 's1', phase: 'end', reason: 'manual', aborted: true, operation: 'context_compaction', trigger: 'manual', executed: true })
    expect(aborted.executed).toBe(true)
  })
})
