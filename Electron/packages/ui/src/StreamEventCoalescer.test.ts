import { describe, expect, it, vi } from 'vitest'
import type { StreamEvent } from '@pipi/host-api'
import { StreamEventCoalescer, streamCoalescerMetrics } from './StreamEventCoalescer'

const text = (delta: string, contentIndex = 0): StreamEvent => ({ type: 'text', sessionId: 's', contentIndex, delta })

describe('StreamEventCoalescer', () => {
  it('reduces 1000 high-frequency deltas while preserving the final string', () => {
    vi.useFakeTimers()
    try {
      const applied: StreamEvent[] = []
      const coalescer = new StreamEventCoalescer({ onEvent: event => applied.push(event) })
      // 1,000 tokens over one second: UI work remains near 20 trailing flushes/s + leading.
      for (let i = 0; i < 1000; i++) { coalescer.push(text('x')); vi.advanceTimersByTime(1) }
      vi.advanceTimersByTime(50)
      const output = applied.filter((event): event is Extract<StreamEvent, { type: 'text' }> => event.type === 'text').map(event => event.delta).join('')
      expect(output).toBe('x'.repeat(1000))
      expect(streamCoalescerMetrics(coalescer).emittedDeltas).toBeLessThanOrEqual(25 + 1)
    } finally { vi.useRealTimers() }
  })

  it('leading-flushes the first non-empty delta without waiting 50ms', () => {
    vi.useFakeTimers()
    try {
      const applied: StreamEvent[] = []
      const coalescer = new StreamEventCoalescer({ onEvent: event => applied.push(event) })
      coalescer.push(text('first'))
      expect(applied).toEqual([text('first')])
      vi.advanceTimersByTime(49)
      expect(applied).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  it('flushes before boundaries and preserves thinking → text → tool order', () => {
    vi.useFakeTimers()
    try {
      const applied: StreamEvent[] = []
      const coalescer = new StreamEventCoalescer({ onEvent: event => applied.push(event) })
      coalescer.push({ type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'a' })
      coalescer.push({ type: 'thinking', sessionId: 's', contentIndex: 0, delta: 'b' })
      coalescer.push(text('c'))
      coalescer.push({ type: 'tool_call', sessionId: 's', toolCallId: 't', name: 'read', delta: 'd' })
      coalescer.push({ type: 'tool_call', sessionId: 's', toolCallId: 't', name: 'read', delta: 'e' })
      coalescer.push({ type: 'tool_result', sessionId: 's', toolCallId: 't', content: 'done' })
      expect(applied.map(event => event.type)).toEqual(['thinking', 'thinking', 'text', 'tool_call', 'tool_call', 'tool_result'])
      expect((applied[1] as Extract<StreamEvent, { type: 'thinking' }>).delta).toBe('b')
      expect((applied[4] as Extract<StreamEvent, { type: 'tool_call' }>).delta).toBe('e')
    } finally { vi.useRealTimers() }
  })

  it('never merges thinking deltas from different message segments sharing a contentIndex', () => {
    vi.useFakeTimers()
    try {
      const applied: StreamEvent[] = []
      const coalescer = new StreamEventCoalescer({ onEvent: event => applied.push(event) })
      coalescer.push({ type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: 'first' })
      coalescer.push({ type: 'thinking', sessionId: 's', contentIndex: 0, segment: 0, delta: ' more' })
      coalescer.push({ type: 'thinking', sessionId: 's', contentIndex: 0, segment: 1, delta: 'second' })
      coalescer.dispose()
      const thinking = applied.filter((event): event is Extract<StreamEvent, { type: 'thinking' }> => event.type === 'thinking')
      expect(thinking).toHaveLength(3)
      // The segment-1 delta must keep its own segment attribution.
      expect(thinking[2]).toMatchObject({ segment: 1, delta: 'second' })
    } finally { vi.useRealTimers() }
  })

  it('flushes pending final content on dispose', () => {
    const applied: StreamEvent[] = []
    const coalescer = new StreamEventCoalescer({ onEvent: event => applied.push(event) })
    coalescer.push(text('a'))
    coalescer.push(text('b'))
    coalescer.dispose()
    expect(applied.map(event => event.type === 'text' ? event.delta : '')).toEqual(['a', 'b'])
  })
})
