// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, SessionStats, SessionStatsEvent } from '@pipi/host-api'
import { SessionStatsPill } from './SessionStatsPill'

beforeEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})

const sampleStats: SessionStats = {
  sessionId: 's1',
  tokens: { input: 12_000, output: 3_400, cacheRead: 8_900, cacheWrite: 2_100, total: 26_400 },
  cost: 0.0312,
  contextUsage: { tokens: 67_000, contextWindow: 272_000, percent: 24.6 },
  model: { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
  performance: { ttftMs: 830, tokensPerSecond: 42.46, sampleCount: 12 }
}

function emptyStats(sessionId = 's1'): SessionStats {
  return { sessionId, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }
}

interface StatsHostHarness {
  host: PipiHostAPI
  getSessionStats: ReturnType<typeof vi.fn>
  subscribeSessionStats: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  emit: (event: SessionStatsEvent) => void
}

function statsHost(options: { snapshots?: Record<string, SessionStats>; failGet?: boolean } = {}): StatsHostHarness {
  const snapshots = options.snapshots ?? {}
  const unsubscribe = vi.fn()
  let push: ((event: SessionStatsEvent) => void) | undefined
  const getSessionStats = vi.fn(async (sessionId?: string) => {
    if (options.failGet) throw new Error('host unavailable')
    if (sessionId !== undefined && snapshots[sessionId]) return snapshots[sessionId]
    return emptyStats(sessionId)
  })
  const subscribeSessionStats = vi.fn((listener: (event: SessionStatsEvent) => void) => {
    push = listener
    return unsubscribe
  })
  return {
    host: { protocolVersion: 2, getSessionStats, subscribeSessionStats } as unknown as PipiHostAPI,
    getSessionStats,
    subscribeSessionStats,
    unsubscribe,
    emit: (event: SessionStatsEvent) => push?.(event)
  }
}

describe('SessionStatsPill', () => {
  it('shows a compact loading chip while the initial fetch is pending', () => {
    let resolveFetch: (stats: SessionStats) => void = () => undefined
    const getSessionStats = vi.fn(() => new Promise<SessionStats>(resolve => { resolveFetch = resolve }))
    const host = { protocolVersion: 2, getSessionStats, subscribeSessionStats: () => () => undefined } as unknown as PipiHostAPI
    render(<SessionStatsPill host={host} sessionId="s1" />)

    expect(screen.getByTestId('stats-loading').getAttribute('aria-busy')).toBe('true')

    resolveFetch(emptyStats('s1'))
  })

  it('hides the context metric when the host reported no context facts', async () => {
    const { host } = statsHost()
    const { container } = render(<SessionStatsPill host={host} sessionId="s1" />)
    await waitFor(() => expect(host.getSessionStats).toHaveBeenCalledWith('s1'))
    expect(container.firstChild).toBeNull()
  })

  it('shows a stable used/window context value even when usage is zero', async () => {
    const zeroUsage: SessionStats = {
      ...emptyStats(),
      contextUsage: { tokens: 0, contextWindow: 200_000, percent: 0 }
    }
    const { host } = statsHost({ snapshots: { s1: zeroUsage } })
    render(<SessionStatsPill host={host} sessionId="s1" />)
    expect((await screen.findByTestId('stats-pill')).textContent).toBe('0/200k')
  })

  it('shows the context ring capsule with compact token counts', async () => {
    const { host } = statsHost({ snapshots: { s1: sampleStats } })
    render(<SessionStatsPill host={host} sessionId="s1" />)

    const pill = await screen.findByTestId('stats-pill')
    expect(pill.textContent).toBe('67k/272k')
    const ring = screen.getByTestId('context-progress-ring')
    expect(ring.querySelector('.session-stats-pill__ring-fill')?.getAttribute('stroke-dasharray')).toBe(`${(67_000 / 272_000) * 36.13} 36.13`)
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog')
    expect(pill.getAttribute('aria-expanded')).toBe('false')
  })

  it('renders a "生成中…" indicator while streaming', async () => {
    const { host } = statsHost({ snapshots: { s1: sampleStats } })
    render(<SessionStatsPill host={host} sessionId="s1" isStreaming />)
    expect(await screen.findByTestId('stats-streaming')).toBeTruthy()
    expect(screen.getByTestId('stats-streaming').textContent).toContain('生成中')
  })

  it('shows "压缩中…" instead of the streaming indicator while compacting', async () => {
    const { host } = statsHost({ snapshots: { s1: sampleStats } })
    render(<SessionStatsPill host={host} sessionId="s1" isStreaming isCompacting />)
    expect((await screen.findByTestId('stats-compacting')).textContent).toContain('压缩中')
    expect(screen.queryByTestId('stats-streaming')).toBeNull()
  })

  it('refreshes from a session_stats push', async () => {
    const { host, emit } = statsHost({ snapshots: { s1: sampleStats } })
    render(<SessionStatsPill host={host} sessionId="s1" />)
    expect((await screen.findByTestId('stats-pill')).textContent).toBe('67k/272k')

    emit({
      type: 'snapshot',
      sessionId: 's1',
      stats: { ...sampleStats, contextUsage: { tokens: 120_000, contextWindow: 272_000, percent: 44.1 } }
    })
    await waitFor(() => expect(screen.getByTestId('stats-pill').textContent).toBe('120k/272k'))
  })

  it('shows ?/window when usage is unknown but the context window is reported', async () => {
    const unknownUsage: SessionStats = {
      ...emptyStats(),
      contextUsage: { tokens: null, contextWindow: 200_000, percent: null }
    }
    const { host } = statsHost({ snapshots: { s1: unknownUsage } })
    render(<SessionStatsPill host={host} sessionId="s1" />)
    expect((await screen.findByTestId('stats-pill')).textContent).toBe('?/200k')
  })

  it('preserves a known context window when a later snapshot omits contextUsage', async () => {
    const { host, emit } = statsHost({ snapshots: { s1: sampleStats } })
    render(<SessionStatsPill host={host} sessionId="s1" />)
    expect((await screen.findByTestId('stats-pill')).textContent).toBe('67k/272k')

    emit({ type: 'snapshot', sessionId: 's1', stats: { ...emptyStats(), tokens: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, total: 100 } } })
    await waitFor(() => expect(screen.getByTestId('stats-pill').textContent).toBe('?/272k'))
  })

  it('ignores pushes for other sessions', async () => {
    const { host, emit } = statsHost({ snapshots: { s1: sampleStats } })
    render(<SessionStatsPill host={host} sessionId="s1" />)
    await screen.findByTestId('stats-pill')

    emit({ type: 'snapshot', sessionId: 'other', stats: { ...emptyStats('other'), contextUsage: { tokens: 200_000, contextWindow: 272_000, percent: 73.5 } } })
    expect(screen.getByTestId('stats-pill').textContent).toBe('67k/272k')
  })

  it('unsubscribes the old subscription and refetches when sessionId changes', async () => {
    const { host, getSessionStats, unsubscribe, emit } = statsHost({
      snapshots: { a: { ...sampleStats, sessionId: 'a' }, b: { ...sampleStats, sessionId: 'b', contextUsage: { tokens: 5_000, contextWindow: 272_000, percent: 1.8 } } }
    })
    const { rerender } = render(<SessionStatsPill host={host} sessionId="a" />)
    expect(await screen.findByTestId('stats-pill')).toBeTruthy()
    expect(getSessionStats).toHaveBeenLastCalledWith('a')

    rerender(<SessionStatsPill host={host} sessionId="b" />)
    await waitFor(() => expect(getSessionStats).toHaveBeenLastCalledWith('b'))
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    // A late push for the old session must not leak into the new one.
    emit({ type: 'snapshot', sessionId: 'a', stats: { ...sampleStats, sessionId: 'a', contextUsage: { tokens: 999_000, contextWindow: 272_000, percent: 90 } } })
    expect((await screen.findByTestId('stats-pill')).textContent).toBe('5k/272k')
  })

  it('does not substitute cumulative session tokens for absent context usage', async () => {
    const noContext: SessionStats = { sessionId: 's1', tokens: { input: 12_000, output: 3_400, cacheRead: 8_900, cacheWrite: 2_100, total: 26_400 }, cost: 0.0312 }
    const { host } = statsHost({ snapshots: { s1: noContext } })
    const { container } = render(<SessionStatsPill host={host} sessionId="s1" />)
    await waitFor(() => expect(host.getSessionStats).toHaveBeenCalledWith('s1'))
    expect(container.firstChild).toBeNull()
  })

  describe('popover', () => {
    it('opens above the pill with all accounting fields', async () => {
      const { host } = statsHost({ snapshots: { s1: sampleStats } })
      render(<SessionStatsPill host={host} sessionId="s1" />)
      fireEvent.click(await screen.findByTestId('stats-pill'))

      const popover = screen.getByTestId('stats-popover')
      expect(popover.getAttribute('role')).toBe('dialog')
      expect(popover.getAttribute('aria-label')).toBe('上下文占用统计')
      expect(screen.getByTestId('stats-pill').getAttribute('aria-expanded')).toBe('true')

      // Context occupancy: 67k/272k, 25% (24.6 rounded), progressbar.
      expect(popover.textContent).toContain('67k / 272k')
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')

      // Session accounting rows (compact Swift-style tokens).
      expect(screen.getByTestId('stats-input').textContent).toBe('12k')
      expect(screen.getByTestId('stats-output').textContent).toBe('3.4k')
      expect(screen.getByTestId('stats-cache-read').textContent).toBe('8.9k')
      expect(screen.getByTestId('stats-cache-hit').textContent).toBe('43%')
      expect(screen.getByTestId('stats-cost').textContent).toBe('$0.031')
      expect(screen.getByTestId('stats-model').textContent).toBe('Claude Sonnet 4')

      // Performance rows appear only because the host reported them.
      expect(screen.getByTestId('stats-samples').textContent).toBe('12 次采样')
      expect(screen.getByTestId('stats-ttft').textContent).toBe('0.83s')
      expect(screen.getByTestId('stats-tps').textContent).toBe('42.5 tok/s')
    })

    it('shows "—" for cache hit rate and hides performance when absent', async () => {
      // cacheRead + input == 0 → denominator is 0 → "—" per spec.
      const noPerf: SessionStats = {
        sessionId: 's1',
        tokens: { input: 0, output: 3_400, cacheRead: 0, cacheWrite: 0, total: 3_400 },
        cost: 0,
        contextUsage: { tokens: 5_000, contextWindow: 272_000, percent: 1.8 }
      }
      const { host } = statsHost({ snapshots: { s1: noPerf } })
      render(<SessionStatsPill host={host} sessionId="s1" />)
      fireEvent.click(await screen.findByTestId('stats-pill'))

      expect(screen.getByTestId('stats-cache-hit').textContent).toBe('—')
      expect(screen.getByTestId('stats-cost').textContent).toBe('$0')
      expect(screen.queryByTestId('stats-ttft')).toBeNull()
      expect(screen.queryByTestId('stats-tps')).toBeNull()
      expect(screen.queryByTestId('stats-samples')).toBeNull()
      expect(screen.queryByTestId('stats-model')).toBeNull()
    })

    it('falls back to the derived percent when the host omitted it', async () => {
      const derived: SessionStats = {
        ...sampleStats,
        contextUsage: { tokens: 67_000, contextWindow: 272_000, percent: null }
      }
      const { host } = statsHost({ snapshots: { s1: derived } })
      render(<SessionStatsPill host={host} sessionId="s1" />)
      fireEvent.click(await screen.findByTestId('stats-pill'))
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25')
    })

    it('shows CNY cost when a rate is provided', async () => {
      const { host } = statsHost({ snapshots: { s1: sampleStats } })
      render(<SessionStatsPill host={host} sessionId="s1" costUnit="CNY" exchangeRate={7.2} />)
      fireEvent.click(await screen.findByTestId('stats-pill'))
      expect(screen.getByTestId('stats-cost').textContent).toBe('¥0.225')
    })

    it('closes on Escape', async () => {
      const { host } = statsHost({ snapshots: { s1: sampleStats } })
      render(<SessionStatsPill host={host} sessionId="s1" />)
      fireEvent.click(await screen.findByTestId('stats-pill'))
      expect(screen.getByTestId('stats-popover')).toBeTruthy()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByTestId('stats-popover')).toBeNull()
      expect(screen.getByTestId('stats-pill').getAttribute('aria-expanded')).toBe('false')
    })

    it('closes on outside click but stays open when clicking inside', async () => {
      const { host } = statsHost({ snapshots: { s1: sampleStats } })
      render(<SessionStatsPill host={host} sessionId="s1" />)
      fireEvent.click(await screen.findByTestId('stats-pill'))
      expect(screen.getByTestId('stats-popover')).toBeTruthy()

      fireEvent.pointerDown(screen.getByTestId('stats-cost'))
      expect(screen.getByTestId('stats-popover')).toBeTruthy()

      fireEvent.pointerDown(document.body)
      expect(screen.queryByTestId('stats-popover')).toBeNull()
    })
  })

  it('auto-retries a transient getSessionStats failure before showing stats', async () => {
    vi.useFakeTimers()
    const harness = statsHost({ snapshots: { s1: sampleStats } })
    harness.getSessionStats
      .mockRejectedValueOnce(new Error('session is read-only: held by pipiui-electron'))
      .mockRejectedValueOnce(new Error('session is read-only: held by pipiui-electron'))
    render(<SessionStatsPill host={harness.host} sessionId="s1" />)

    // The first attempt fails immediately; the two backoff retries (300ms/1000ms)
    // recover on the third attempt without any user interaction.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    expect(screen.getByTestId('stats-pill').textContent).toBe('67k/272k')
    expect(harness.getSessionStats).toHaveBeenCalledTimes(3)
    expect(screen.queryByTestId('stats-error')).toBeNull()
  })

  it('shows 统计不可用 only after automatic retries are exhausted, then retry() refetches', async () => {
    vi.useFakeTimers()
    const harness = statsHost({ snapshots: { s1: sampleStats } })
    harness.getSessionStats.mockRejectedValue(new Error('host unavailable'))
    render(<SessionStatsPill host={harness.host} sessionId="s1" />)

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    const chip = screen.getByTestId('stats-error')
    expect(chip.textContent).toBe('统计不可用')
    expect(harness.getSessionStats).toHaveBeenCalledTimes(3)

    harness.getSessionStats.mockResolvedValue(sampleStats)
    fireEvent.click(chip)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByTestId('stats-pill').textContent).toBe('67k/272k')
    expect(harness.getSessionStats).toHaveBeenCalledTimes(4)
  })

  it('can be dismissed after an error', async () => {
    vi.useFakeTimers()
    const dismissHarness = statsHost({ failGet: true })
    render(<SessionStatsPill host={dismissHarness.host} sessionId="s1" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    screen.getByTestId('stats-error')
    fireEvent.click(screen.getByRole('button', { name: '关闭会话统计不可用提示' }))
    expect(screen.queryByTestId('stats-unavailable')).toBeNull()
  })

})
