// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, StreamEvent } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'

beforeEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(window, 'pipiHost')
})

describe('tool execution updates stream into the waiting placeholder', () => {
  it('shows the latest mid-execution partial as the waiting detail and clears it when the tool ends', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    // Open a turn and start a tool; the detail first reflects the args summary.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started', pendingFollowUps: ['queued'] }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'n1', name: 'narrate', delta: '{"text":"……"}' }) })
    await screen.findByTestId('waiting-placeholder')

    // Mid-execution partials replace the args summary, newest first.
    const detail = () => document.querySelector('.waiting-placeholder__detail')?.textContent
    act(() => { listener?.({ type: 'tool_update', sessionId: 'layout', toolCallId: 'n1', name: 'narrate', text: 'Writing turn record' }) })
    await waitFor(() => expect(detail()).toBe('narrate · Writing turn record'))
    act(() => { listener?.({ type: 'tool_update', sessionId: 'layout', toolCallId: 'n1', name: 'narrate', text: 'Committing turn' }) })
    await waitFor(() => expect(detail()).toBe('narrate · Committing turn'))

    // The terminal result ends the tool wait; the detail line goes with it.
    act(() => { listener?.({ type: 'tool_result', sessionId: 'layout', toolCallId: 'n1', content: 'done', isError: false }) })
    await waitFor(() => expect(document.querySelector('.waiting-placeholder__detail')).toBeNull())
  })
})
