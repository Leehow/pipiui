import { describe, expect, it } from 'vitest'
import {
  TRANSCRIPT_FIRST_ITEM_BASE,
  TRANSCRIPT_PIN_MAX_ATTEMPTS,
  nextTranscriptFirstItemIndex,
  transcriptDataIndex,
  transcriptMessageIdentity,
  transcriptTailVirtualIndex,
} from './transcript-scroll'

function ids(count: number, start = 0): string[] {
  return Array.from({ length: count }, (_, index) => `m${start + index}`)
}

describe('nextTranscriptFirstItemIndex', () => {
  it('keeps the newest virtual index stable when 500 newest rows get 500 older rows prepended', () => {
    const newest = ids(500, 500)
    const older = ids(500, 0)
    const full = [...older, ...newest]
    const firstPage = nextTranscriptFirstItemIndex(TRANSCRIPT_FIRST_ITEM_BASE, [], newest)
    expect(firstPage).toBe(TRANSCRIPT_FIRST_ITEM_BASE)
    const afterPrepend = nextTranscriptFirstItemIndex(firstPage, newest, full)
    expect(afterPrepend).toBe(TRANSCRIPT_FIRST_ITEM_BASE - 500)
    expect(transcriptTailVirtualIndex(afterPrepend, full.length)).toBe(transcriptTailVirtualIndex(firstPage, newest.length))
  })

  it('does not move firstItemIndex on a tail append', () => {
    const current = ids(8)
    const appended = [...current, 'm8']
    const first = nextTranscriptFirstItemIndex(TRANSCRIPT_FIRST_ITEM_BASE, [], current)
    expect(nextTranscriptFirstItemIndex(first, current, appended)).toBe(first)
    expect(transcriptTailVirtualIndex(first, appended.length)).toBe(first + appended.length - 1)
  })

  it('resets on clear, first page, and branch replacement', () => {
    const page = ids(4, 10)
    const shifted = nextTranscriptFirstItemIndex(TRANSCRIPT_FIRST_ITEM_BASE, page, [...ids(3), ...page])
    expect(nextTranscriptFirstItemIndex(shifted, [...ids(3), ...page], [])).toBe(TRANSCRIPT_FIRST_ITEM_BASE)
    expect(nextTranscriptFirstItemIndex(shifted, [], page)).toBe(TRANSCRIPT_FIRST_ITEM_BASE)
    expect(nextTranscriptFirstItemIndex(shifted, page, ids(4, 90))).toBe(TRANSCRIPT_FIRST_ITEM_BASE)
  })

  it('never returns a negative firstItemIndex', () => {
    const current = ids(5)
    const prepended = [...ids(20, 100), ...current]
    expect(nextTranscriptFirstItemIndex(3, current, prepended)).toBe(0)
  })

  it('retains positive exact headroom after a million-row prepend', () => {
    const current = ['tail-a', 'tail-b']
    const prependedCount = 1_000_001
    const full = new Array<string>(prependedCount).fill('older')
    full.push(...current)
    const next = nextTranscriptFirstItemIndex(TRANSCRIPT_FIRST_ITEM_BASE, current, full)
    expect(next).toBe(TRANSCRIPT_FIRST_ITEM_BASE - prependedCount)
    expect(next).toBeGreaterThan(0)
    expect(Number.isSafeInteger(next)).toBe(true)
  })

  it('distinguishes different messages that reuse a host id', () => {
    const first = transcriptMessageIdentity({ id: 'duplicate', role: 'user', timestamp: 1, content: 'first' })
    const second = transcriptMessageIdentity({ id: 'duplicate', role: 'assistant', timestamp: 2, content: 'second' })
    expect(first).not.toBe(second)
    expect(nextTranscriptFirstItemIndex(TRANSCRIPT_FIRST_ITEM_BASE, [first, second], ['older', first, second])).toBe(TRANSCRIPT_FIRST_ITEM_BASE - 1)
  })

  it('maps virtual indices back to data indices and leaves mock data indices alone', () => {
    expect(transcriptDataIndex(TRANSCRIPT_FIRST_ITEM_BASE + 3, TRANSCRIPT_FIRST_ITEM_BASE)).toBe(3)
    expect(transcriptDataIndex(3, TRANSCRIPT_FIRST_ITEM_BASE)).toBe(3)
  })

  it('keeps each event-driven retry burst explicitly bounded', () => {
    expect(TRANSCRIPT_PIN_MAX_ATTEMPTS).toBeGreaterThan(1)
    expect(TRANSCRIPT_PIN_MAX_ATTEMPTS).toBeLessThanOrEqual(8)
  })
})
