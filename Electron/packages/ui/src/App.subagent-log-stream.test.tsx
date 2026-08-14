// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App, createMockHost } from './App'

afterEach(() => {
  cleanup()
})

/** Expand every collapsed activity card so folded tool/thinking bodies become visible. */
function expandAllCards() {
  for (let pass = 0; pass < 4; pass += 1) {
    const collapsed = screen.queryAllByRole('button').filter(b => b.getAttribute('aria-expanded') === 'false' && b.closest('[data-activity-card]'))
    if (!collapsed.length) break
    collapsed.forEach(b => fireEvent.click(b))
  }
}

/**
 * Browser-demo equivalent of the SubagentPanel upsert tests: render the real demo
 * (createMockHost fixture) and drive the 'research' agent's streamed log_delta
 * flow. The fixture pushes cumulative snapshots keyed by contentIndex (5 chunks
 * at 300ms intervals); the panel must collapse them into one unified message
 * with the latest cumulative text, not one row per chunk.
 */
describe('demo subagent log streaming', () => {
  it('renders one progressively-updated row per contentIndex instead of one per chunk', async () => {
    const host = createMockHost()
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')

    const researchRow = await screen.findByTestId('agent-row-research')
    fireEvent.click(researchRow.querySelector('.agent-select')!)
    await waitFor(() => expect(researchRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))

    // Wait for the full stream to finish (thinking×2 + tool×1 + toolResult×2 chunks):
    // the toolResult text lives inside a collapsed tool card, so wait on the step
    // card (2 个步骤 = thinking + read) that only appears once the stream settles.
    const transcript = await screen.findByTestId('subagent-transcript')
    await screen.findByRole('button', { name: /2 个步骤/ })
    // The 5 cumulative snapshots collapse into one unified transcript message
    // (thinking + read tool), not one card per chunk.
    expect(transcript.querySelectorAll('[data-testid="assistant-transcript-content"]')).toHaveLength(1)

    // Cards are collapsed by default; expand everything, then verify each row carries
    // its final cumulative text (the intermediate first-chunk-only snapshot must not
    // linger as its own row).
    await waitFor(() => expandAllCards())
    expect(await screen.findByText(/，对照 App 与 SubagentPanel 的日志渲染路径/)).toBeTruthy()
    expect(screen.queryByText('正在梳理 packages/ui 的组件边界', { exact: true })).toBeNull()
    expect(screen.getByText(/确认流式更新逻辑位于 SubagentPanel。/)).toBeTruthy()
  })
})
