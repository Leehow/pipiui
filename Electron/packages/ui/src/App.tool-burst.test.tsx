// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const virtuosoHarness = { atBottom: undefined as undefined | ((value: boolean) => void), scrollToIndex: vi.fn() }
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent, atBottomStateChange }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element; atBottomStateChange?: (value: boolean) => void }, ref) => { virtuosoHarness.atBottom = atBottomStateChange; React.useImperativeHandle(ref, () => ({ scrollToIndex: virtuosoHarness.scrollToIndex })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { buffer = { active: { viewportY: 0, baseY: 0 } }; options = {}; open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); onData() { return { dispose: vi.fn() } } onScroll() { return { dispose: vi.fn() } } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'

beforeEach(() => {
  localStorage.clear()
})

describe('demo tool-burst session: consecutive tool rounds coalesce into one card', () => {
  it('shows a single "7 个步骤 · bash ×6" summary card, expandable to tool details', async () => {
    const { container } = render(<App host={createMockHost()} />)
    await screen.findAllByText('Electron 三栏界面')
    // Navigate to the tool-burst demo session (6 bash + 1 browser tool rounds);
    // session rows load asynchronously, so wait for the row to appear first.
    await waitFor(() => expect(container.querySelector('[data-session-id="tool-burst"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="tool-burst"]')!)
    await waitFor(() => expect(screen.getByRole('button', { name: /7 个步骤 · bash ×6/ })).toBeTruthy())
    // Exactly one summary card — not seven stacked "1 个步骤" cards.
    expect(screen.getAllByRole('button', { name: /个步骤/ }).length).toBe(1)
    const outer = screen.getByRole('button', { name: /7 个步骤 · bash ×6/ })
    expect(outer.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(outer)
    expect(outer.getAttribute('aria-expanded')).toBe('true')
    // Expanded detail: all 7 tool calls render as collapsed sub-cards.
    expect(container.querySelectorAll('.activity-card-tool .activity-summary')).toHaveLength(7)
    const bashCards = [...container.querySelectorAll('.activity-card-tool .activity-summary')].filter(button => button.textContent?.includes('bash ·'))
    expect(bashCards).toHaveLength(6)
    expect(screen.getByRole('button', { name: /browser · navigate http:\/\/localhost:5176/ })).toBeTruthy()
  })
})
