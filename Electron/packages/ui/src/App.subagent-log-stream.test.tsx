// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App, createMockHost } from './App'

afterEach(() => {
  cleanup()
})

/**
 * Browser-demo equivalent of the SubagentPanel upsert tests: render the real demo
 * (createMockHost fixture) and drive the 'research' agent's streamed log_delta
 * flow. The fixture pushes cumulative snapshots keyed by contentIndex (5 chunks
 * at 300ms intervals); the panel must collapse them into 3 rows — one per
 * contentIndex — with the latest cumulative text, not one row per chunk.
 */
describe('demo subagent log streaming', () => {
  it('renders one progressively-updated row per contentIndex instead of one per chunk', async () => {
    const host = createMockHost()
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    const researchRow = await screen.findByTestId('agent-row-research')
    fireEvent.click(researchRow.querySelector('.agent-select')!)
    await waitFor(() => expect(researchRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))

    // Wait for the full stream to finish (thinking×2 + tool×1 + toolResult×2 chunks).
    await screen.findByText(/确认流式更新逻辑位于 SubagentPanel/, {}, { timeout: 4_000 })

    const log = screen.getByTestId('agent-log')
    // 5 cumulative snapshots collapse into 3 rows: thinking, tool, toolResult.
    expect(log.querySelectorAll('[data-activity-card]')).toHaveLength(3)
    expect(log.querySelector('[data-activity-card="thinking"]')).toBeTruthy()
    expect(log.querySelector('[data-activity-card="tool"]')).toBeTruthy()
    expect(log.querySelector('[data-activity-card="result"]')).toBeTruthy()

    // The thinking row carries the final cumulative text — the intermediate
    // first-chunk-only snapshot must not linger as its own row.
    expect(log.querySelector('[data-activity-card="thinking"]')?.textContent).toContain('，对照 App 与 SubagentPanel 的日志渲染路径')
    expect(screen.queryByText('正在梳理 packages/ui 的组件边界', { exact: true })).toBeNull()
    // Same for toolResult: partial snapshot replaced by the full one.
    expect(log.querySelector('[data-activity-card="result"]')?.textContent).toContain('确认流式更新逻辑位于 SubagentPanel。')
  })
})
