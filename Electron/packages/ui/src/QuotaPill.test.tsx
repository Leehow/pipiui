// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, QuotaSnapshot } from '@pipi/host-api'
import { QuotaPill } from './QuotaPill'

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

const codexSnapshot: QuotaSnapshot = {
  provider: 'codex',
  accountLabel: 'Codex 账号额度',
  windows: [
    { id: 'window0', usedPercent: 4, label: '5h', title: '5小时额度' },
    { id: 'window1', usedPercent: 41, label: '周', title: '周额度' }
  ]
}

function quotaHost(snapshot: QuotaSnapshot | null): { host: PipiHostAPI; getQuotaSnapshot: ReturnType<typeof vi.fn> } {
  const getQuotaSnapshot = vi.fn(async () => snapshot)
  return { host: { protocolVersion: 2, getQuotaSnapshot } as unknown as PipiHostAPI, getQuotaSnapshot }
}

describe('QuotaPill', () => {
  it('renders the Swift-style period label (highest-use window) as a clickable pill', async () => {
    const { host, getQuotaSnapshot } = quotaHost(codexSnapshot)
    render(<QuotaPill host={host} sessionId="s1" provider="openai-codex" />)
    const pill = await screen.findByTestId('quota-pill')
    expect(getQuotaSnapshot).toHaveBeenCalledWith('s1')
    expect(pill.textContent).toBe('周 41%')
    expect(pill.tagName).toBe('BUTTON')
    expect(pill.getAttribute('aria-haspopup')).toBe('menu')
    expect(pill.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the backend-provided 月 period label', async () => {
    const { host } = quotaHost({
      provider: 'codex',
      accountLabel: 'Codex 账号额度',
      windows: [{ id: 'monthly', usedPercent: 12, label: '月', title: '月额度' }]
    })
    render(<QuotaPill host={host} provider="openai-codex" />)
    expect((await screen.findByTestId('quota-pill')).textContent).toBe('月 12%')
  })

  it('opens a popover listing every reported window with a checkmark on the current one', async () => {
    const { host } = quotaHost(codexSnapshot)
    render(<QuotaPill host={host} provider="openai-codex" />)
    fireEvent.click(await screen.findByTestId('quota-pill'))
    const menu = await screen.findByTestId('quota-menu')
    expect(menu.textContent).toContain('Codex 账号额度')
    expect(menu.textContent).toContain('5小时额度')
    expect(menu.textContent).toContain('周额度')
    // Default selection is the highest-usage window (周 41%).
    expect((screen.getByTestId('quota-row-window1') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByTestId('quota-row-window0') as HTMLButtonElement).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('quota-row-window1').textContent).toContain('✓')
    expect(screen.getByTestId('quota-row-window0').textContent).not.toContain('✓')
  })

  it('switches the capsule immediately on pick, persists the pick per provider, and keeps the popover open', async () => {
    const { host } = quotaHost(codexSnapshot)
    render(<QuotaPill host={host} provider="openai-codex" />)
    fireEvent.click(await screen.findByTestId('quota-pill'))
    fireEvent.click(await screen.findByTestId('quota-row-window0'))
    // Capsule updates without closing the popover (Swift parity).
    expect(screen.getByTestId('quota-pill').textContent).toBe('5h 4%')
    expect(screen.getByTestId('quota-menu')).toBeTruthy()
    expect(localStorage.getItem('pipiui.quotaWindow.codex')).toBe('window0')
  })

  it('restores a persisted window selection on remount (per-provider key)', async () => {
    localStorage.setItem('pipiui.quotaWindow.codex', 'window0')
    const { host } = quotaHost(codexSnapshot)
    render(<QuotaPill host={host} provider="openai-codex" />)
    expect((await screen.findByTestId('quota-pill')).textContent).toBe('5h 4%')
  })

  it('keeps a pick isolated per provider (Grok pick never shows on Codex)', async () => {
    localStorage.setItem('pipiui.quotaWindow.glm', 'window0')
    const { host } = quotaHost(codexSnapshot)
    render(<QuotaPill host={host} provider="openai-codex" />)
    // The Codex key is empty, so the capsule falls back to highest usage.
    expect((await screen.findByTestId('quota-pill')).textContent).toBe('周 41%')
  })

  it('falls back to the highest-usage window when the persisted id is stale', async () => {
    localStorage.setItem('pipiui.quotaWindow.codex', 'gone')
    const { host } = quotaHost(codexSnapshot)
    render(<QuotaPill host={host} provider="openai-codex" />)
    expect((await screen.findByTestId('quota-pill')).textContent).toBe('周 41%')
  })

  it('closes the popover on outside click or re-clicking the pill', async () => {
    const { host } = quotaHost(codexSnapshot)
    const { container } = render(<QuotaPill host={host} provider="openai-codex" />)
    const pill = await screen.findByTestId('quota-pill')
    fireEvent.click(pill)
    await screen.findByTestId('quota-menu')
    fireEvent.mouseDown(container.querySelector('.quick-menu-backdrop')!)
    expect(screen.queryByTestId('quota-menu')).toBeNull()
    fireEvent.click(pill)
    await screen.findByTestId('quota-menu')
    fireEvent.click(pill)
    expect(screen.queryByTestId('quota-menu')).toBeNull()
  })

  it('renders nothing when the host has no getQuotaSnapshot (older host)', async () => {
    const host = { protocolVersion: 2 } as unknown as PipiHostAPI
    const { container } = render(<QuotaPill host={host} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('renders nothing when the provider has no quota source (null snapshot)', async () => {
    const { host, getQuotaSnapshot } = quotaHost(null)
    const { container } = render(<QuotaPill host={host} provider="deepseek" />)
    await waitFor(() => expect(getQuotaSnapshot).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('hides a partial quota snapshot with no reported used percentage', async () => {
    const { host } = quotaHost({
      provider: 'codex',
      accountLabel: 'Codex 账号额度',
      windows: [{ id: 'weekly', label: '周', title: '周额度' }] as unknown as QuotaSnapshot['windows']
    })
    const { container } = render(<QuotaPill host={host} provider="openai-codex" />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('refetches when the model provider changes (same host data chain)', async () => {
    const { host, getQuotaSnapshot } = quotaHost(codexSnapshot)
    const { rerender } = render(<QuotaPill host={host} provider="openai-codex" />)
    await screen.findByTestId('quota-pill')
    rerender(<QuotaPill host={host} provider="deepseek" />)
    await waitFor(() => expect(getQuotaSnapshot).toHaveBeenCalledTimes(2))
  })
})
