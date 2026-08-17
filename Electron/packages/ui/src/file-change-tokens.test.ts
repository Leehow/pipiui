import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  fileChangeDeltaLabel,
  fileChangeTokenStats,
  formatEstimateCount,
  liveTokenLabel,
} from './file-change-tokens'

describe('estimateTokens / formatEstimateCount', () => {
  it('matches Swift ThinkingTokenEstimate SelfTest', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(''.length)).toBe(0)
    expect(estimateTokens('a'.length)).toBe(1)
    expect(estimateTokens('abcd'.length)).toBe(1)
    expect(estimateTokens('abcde'.length)).toBe(1)
    expect(estimateTokens('abcdef'.length)).toBe(2)
    expect(estimateTokens(4000)).toBe(1000)
    expect(formatEstimateCount(999)).toBe('999')
    expect(formatEstimateCount(1000)).toBe('1k')
    expect(formatEstimateCount(1200)).toBe('1.2k')
    expect(formatEstimateCount(15400)).toBe('15.4k')
    expect(liveTokenLabel(0)).toBeUndefined()
    expect(liveTokenLabel(4800)).toBe('~1.2k tokens')
  })
})

describe('fileChangeTokenStats', () => {
  it('returns null for other tools', () => {
    expect(fileChangeTokenStats('bash', '{"command":"ls"}')).toBeNull()
  })

  it('parses full write JSON', () => {
    const content = 'hello world!!' // 13 chars → 3 tokens
    const stats = fileChangeTokenStats('write', JSON.stringify({ path: 'a.ts', content }))
    expect(stats).toEqual({ path: 'a.ts', payloadChars: 13, addedChars: 13, removedChars: 0 })
    expect(fileChangeDeltaLabel(stats!.addedChars, stats!.removedChars)).toBe('+3')
  })

  it('parses edit edits[] and legacy newText', () => {
    const edits = fileChangeTokenStats('edit', JSON.stringify({
      path: 'b.ts',
      edits: [{ oldText: 'ab', newText: 'abcdef' }, { oldText: 'x', newText: 'yz' }],
    }))
    expect(edits?.payloadChars).toBe(8)
    expect(edits?.addedChars).toBe(8)
    expect(edits?.removedChars).toBe(3)

    const legacy = fileChangeTokenStats('edit', JSON.stringify({ path: 'c.ts', oldText: 'old', newText: 'newer' }))
    expect(legacy).toEqual({ path: 'c.ts', payloadChars: 5, addedChars: 5, removedChars: 3 })
  })

  it('grows write content from truncated JSON', () => {
    const first = fileChangeTokenStats('write', '{"path":"w.ts","content":"abcd')
    const second = fileChangeTokenStats('write', '{"path":"w.ts","content":"abcdefghij')
    expect(first?.payloadChars).toBe(4)
    expect(second?.payloadChars).toBe(10)
    expect(second!.payloadChars).toBeGreaterThan(first!.payloadChars)
  })

  it('scrapes truncated edit newText occurrences', () => {
    const stats = fileChangeTokenStats('edit', '{"path":"e.ts","edits":[{"oldText":"aa","newText":"bbbb')
    expect(stats?.addedChars).toBe(4)
    expect(stats?.removedChars).toBe(2)
  })

  it('honors compact bridge payload counts', () => {
    const stats = fileChangeTokenStats('write', JSON.stringify({
      path: 'huge.ts',
      payloadChars: 40000,
      addedChars: 40000,
      removedChars: 0,
    }))
    expect(stats?.payloadChars).toBe(40000)
    expect(liveTokenLabel(stats!.payloadChars)).toBe('~10k tokens')
  })

  it('hides zero sides in the finished delta label', () => {
    expect(fileChangeDeltaLabel(0, 0)).toBeUndefined()
    expect(fileChangeDeltaLabel(4, 0)).toBe('+1')
    expect(fileChangeDeltaLabel(0, 8)).toBe('\u22122')
    expect(fileChangeDeltaLabel(8, 4)).toBe('+2 \u22121')
  })
})
