// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockHost } from './App'
import { ComputerUsePanel } from './ComputerUsePanel'

afterEach(cleanup)

describe('ComputerUsePanel', () => {
  it('loads and persists the master desktop-control switch', async () => {
    const host = createMockHost()
    render(<ComputerUsePanel host={host} onClose={() => undefined} />)
    const toggle = await screen.findByRole('switch', { name: '启用 Computer Use' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    await expect(host.getComputerUseState?.()).resolves.toEqual({ enabled: true })
    expect(screen.getByText('屏幕录制')).toBeTruthy()
    expect(screen.getByText('辅助功能')).toBeTruthy()
  })
})
