// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, QuotaSnapshot } from '@pipi/host-api'
import { BalancePill, formatBalance } from './BalancePill'

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

const deepSeekSnapshot: QuotaSnapshot = {
  provider: 'deepseek',
  accountLabel: '账户余额',
  balance: { amount: 88, currency: 'CNY' },
  windows: []
}

function balanceHost(snapshot: QuotaSnapshot | null): { host: PipiHostAPI; getQuotaSnapshot: ReturnType<typeof vi.fn> } {
  const getQuotaSnapshot = vi.fn(async () => snapshot)
  return { host: { protocolVersion: 2, getQuotaSnapshot } as unknown as PipiHostAPI, getQuotaSnapshot }
}

describe('formatBalance mirrors Swift formatBalance', () => {
  it('renders ¥ / $ prefixes with two decimals', () => {
    expect(formatBalance(110, 'CNY')).toBe('¥110.00')
    expect(formatBalance(74.75, 'USD')).toBe('$74.75')
    expect(formatBalance(88, 'CNY')).toBe('¥88.00')
    expect(formatBalance(12.345, 'USD')).toBe('$12.35')
  })
  it('falls back to a currency-code prefix for unknown currencies', () => {
    expect(formatBalance(42, 'EUR')).toBe('EUR 42.00')
  })
})

describe('BalancePill', () => {
  it('renders the Swift-style prepaid balance capsule next to the quota slot', async () => {
    const { host, getQuotaSnapshot } = balanceHost(deepSeekSnapshot)
    render(<BalancePill host={host} sessionId="s1" provider="deepseek" />)
    const pill = await screen.findByTestId('balance-pill')
    expect(getQuotaSnapshot).toHaveBeenCalledWith('s1')
    expect(pill.textContent).toBe('¥88.00')
    expect(pill.getAttribute('aria-label')).toBe('账户余额 ¥88.00')
  })

  it('renders a USD balance with the dollar prefix', async () => {
    const { host } = balanceHost({ provider: 'deepseek', accountLabel: '账户余额', balance: { amount: 74.75, currency: 'USD' }, windows: [] })
    render(<BalancePill host={host} provider="deepseek" />)
    expect((await screen.findByTestId('balance-pill')).textContent).toBe('$74.75')
  })

  it('renders nothing when the host has no getQuotaSnapshot (older host)', async () => {
    const host = { protocolVersion: 2 } as unknown as PipiHostAPI
    const { container } = render(<BalancePill host={host} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders nothing when the provider has no balance (null snapshot)', async () => {
    const { host, getQuotaSnapshot } = balanceHost(null)
    const { container } = render(<BalancePill host={host} provider="deepseek" />)
    await waitFor(() => expect(getQuotaSnapshot).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the snapshot has no balance field', async () => {
    const { host } = balanceHost({ provider: 'codex', accountLabel: 'Codex 账号额度', windows: [{ id: 'window0', usedPercent: 41, label: '周', title: '周额度' }] })
    const { container } = render(<BalancePill host={host} provider="openai-codex" />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('hides balance when quota windows are present even if a balance is reported (quota wins)', async () => {
    const { host } = balanceHost({
      provider: 'deepseek',
      accountLabel: '账户余额',
      balance: { amount: 88, currency: 'CNY' },
      windows: [{ id: 'window0', usedPercent: 41, label: '周', title: '周额度' }]
    } as unknown as QuotaSnapshot)
    const { container } = render(<BalancePill host={host} provider="deepseek" />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('refetches when the model provider changes (same host data chain)', async () => {
    const { host, getQuotaSnapshot } = balanceHost(deepSeekSnapshot)
    const { rerender } = render(<BalancePill host={host} provider="deepseek" />)
    await screen.findByTestId('balance-pill')
    rerender(<BalancePill host={host} provider="openai-codex" />)
    await waitFor(() => expect(getQuotaSnapshot).toHaveBeenCalledTimes(2))
  })

  it('drops the previous capsule immediately when the provider changes', async () => {
    const getQuotaSnapshot = vi.fn(async () => deepSeekSnapshot)
    const host = { protocolVersion: 2, getQuotaSnapshot } as unknown as PipiHostAPI
    const { rerender } = render(<BalancePill host={host} sessionId="s1" provider="deepseek" />)
    expect((await screen.findByTestId('balance-pill')).textContent).toBe('¥88.00')
    getQuotaSnapshot.mockImplementation(() => new Promise(() => undefined))
    rerender(<BalancePill host={host} sessionId="s1" provider="openai-codex" />)
    expect(screen.queryByTestId('balance-pill')).toBeNull()
  })
})
