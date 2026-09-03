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

// The host projection intentionally forwards `user_message` / `status` for
// EVERY session (sidebar correctness). The renderer must consume those as
// sidebar state only — a foreign echo or run state landing in the visible
// transcript is the cross-session bleed users see as “会话记录串了”.
describe('foreign session stream events never bleed into the visible transcript', () => {
  it('drops a foreign user_message echo instead of appending it to the selected transcript', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'user_message', sessionId: 'foreign-session', content: '你看我这个thinking卡住' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'foreign-session', status: 'started' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'foreign-session', status: 'streaming' }) })
    act(() => { listener?.({ type: 'thinking', sessionId: 'foreign-session', contentIndex: 0, delta: 'foreign thinking' }) })

    expect(screen.queryByText(/你看我这个thinking卡住/)).toBeNull()
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('keeps the composer idle while another session runs and settles', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'foreign-session', status: 'started' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'foreign-session', status: 'streaming' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')

    act(() => { listener?.({ type: 'status', sessionId: 'foreign-session', status: 'settled' }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('still applies the selected session own events after ignoring foreign ones', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'user_message', sessionId: 'foreign-session', content: '串会话的脏气泡' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '自己的答复' }) })

    expect(screen.queryByText(/串会话的脏气泡/)).toBeNull()
    await screen.findByText(/自己的答复/)
  })
})
