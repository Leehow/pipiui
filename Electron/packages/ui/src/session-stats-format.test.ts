// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  cacheHitRate,
  contextPercent,
  formatCompactTokens,
  formatCost,
  formatPercent,
  formatTokensPerSecond,
  formatTTFT
} from './session-stats-format'

describe('formatCompactTokens (mirrors Swift TokenFormat.compact)', () => {
  it('renders plain integers below 1000', () => {
    expect(formatCompactTokens(0)).toBe('0')
    expect(formatCompactTokens(7)).toBe('7')
    expect(formatCompactTokens(999)).toBe('999')
  })

  it('switches to k from 1000 with one decimal below 10k', () => {
    expect(formatCompactTokens(1000)).toBe('1k')
    expect(formatCompactTokens(1199)).toBe('1.2k')
    expect(formatCompactTokens(1500)).toBe('1.5k')
    expect(formatCompactTokens(8900)).toBe('8.9k')
    // Swift %.1f rounds half to even: 1.25 → "1.2k"
    expect(formatCompactTokens(1250)).toBe('1.2k')
  })

  it('strips trailing .0 and rounds to an integer from 10k up', () => {
    expect(formatCompactTokens(9999)).toBe('10k')
    expect(formatCompactTokens(10_000)).toBe('10k')
    expect(formatCompactTokens(26_400)).toBe('26k')
    expect(formatCompactTokens(60_000)).toBe('60k')
    expect(formatCompactTokens(200_000)).toBe('200k')
    expect(formatCompactTokens(272_000)).toBe('272k')
  })

  it('keeps Swift parity at the 999999 boundary (1000k)', () => {
    expect(formatCompactTokens(999_999)).toBe('1000k')
  })

  it('uses m from one million', () => {
    expect(formatCompactTokens(1_000_000)).toBe('1m')
    expect(formatCompactTokens(1_500_000)).toBe('1.5m')
    expect(formatCompactTokens(10_000_000)).toBe('10m')
  })

  it('handles negative values with a leading minus', () => {
    expect(formatCompactTokens(-999)).toBe('-999')
    expect(formatCompactTokens(-1500)).toBe('-1.5k')
  })

  it('normalizes non-integer input via truncation', () => {
    expect(formatCompactTokens(1199.9)).toBe('1.2k')
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percentage', () => {
    expect(formatPercent(24.6)).toBe('25%')
    expect(formatPercent(80.4)).toBe('80%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(100)).toBe('100%')
  })
})

describe('cacheHitRate', () => {
  it('computes cacheRead / (input + cacheRead)', () => {
    expect(cacheHitRate(8900, 12_000)).toBe('43%')
    expect(cacheHitRate(5000, 5000)).toBe('50%')
    expect(cacheHitRate(12_000, 0)).toBe('100%')
  })

  it('returns null when the denominator is 0 (UI renders "—")', () => {
    expect(cacheHitRate(0, 0)).toBeNull()
  })

  it('clamps impossible ratios', () => {
    expect(cacheHitRate(0, 5000)).toBe('0%')
  })
})

describe('formatCost (mirrors Swift formatUSD / formatCNY)', () => {
  it('shows $0 for zero or negative cost', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(-0.5)).toBe('$0')
  })

  it('uses adaptive precision', () => {
    expect(formatCost(0.004)).toBe('$0.0040') // < 0.01 → 4 decimals
    expect(formatCost(0.0312)).toBe('$0.031') // < 1 → 3 decimals
    expect(formatCost(1.234)).toBe('$1.23') // ≥ 1 → 2 decimals
    expect(formatCost(12)).toBe('$12.00')
  })

  it('converts to CNY only with a positive rate', () => {
    expect(formatCost(0.0312, 'CNY', 7.2)).toBe('¥0.225')
    expect(formatCost(0.5, 'CNY', 7.2)).toBe('¥3.60')
    expect(formatCost(0, 'CNY', 7.2)).toBe('¥0')
  })

  it('falls back to USD rather than fabricate a conversion', () => {
    expect(formatCost(0.0312, 'CNY')).toBe('$0.031')
    expect(formatCost(0.0312, 'CNY', 0)).toBe('$0.031')
  })
})

describe('formatTTFT (host reports ms, Swift formats seconds)', () => {
  it('uses 2 decimals under 10s and 1 from 10s up', () => {
    expect(formatTTFT(830)).toBe('0.83s')
    expect(formatTTFT(0)).toBe('0.00s')
    expect(formatTTFT(12_500)).toBe('12.5s')
  })
})

describe('formatTokensPerSecond', () => {
  it('always shows one decimal', () => {
    expect(formatTokensPerSecond(42.46)).toBe('42.5 tok/s')
    expect(formatTokensPerSecond(0)).toBe('0.0 tok/s')
  })
})

describe('contextPercent', () => {
  it('prefers the host-reported percent and clamps to 0–100', () => {
    expect(contextPercent(67_000, 272_000, 24.6)).toBe(24.6)
    expect(contextPercent(67_000, 272_000, 300)).toBe(100)
    expect(contextPercent(67_000, 272_000, -5)).toBe(0)
  })

  it('derives from tokens/window when percent is null', () => {
    expect(contextPercent(67_000, 272_000, null)).toBeCloseTo(24.632, 2)
    expect(contextPercent(0, 272_000, null)).toBe(0)
  })

  it('returns null when nothing can be computed', () => {
    expect(contextPercent(null, 272_000, null)).toBeNull()
    expect(contextPercent(67_000, 0, null)).toBeNull()
    expect(contextPercent(null, 0, null)).toBeNull()
  })
})
