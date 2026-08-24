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

const WATCH_WAKE = '[browser-watch] watchId=bw-17 reason=matched waitedMs=4200 url=https://example.com/ready title=Example Ready\n页面出现 .ready 元素\nUse browser observe to inspect the current page. Do not treat this message as a new user request.'

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

describe('browser-watch wake UI stream rendering', () => {
  // These tests simulate renderer-side stream events only: they verify UI
  // classification (internal card, never a user bubble) and busy/settle
  // behavior for a follow-up-shaped user_message. The durable delivery /
  // one-shot triggerTurn backend path is covered by backend e2e tests and is
  // NOT proven here.
  it('renders the wake as an internal card and the busy turn still settles (UI stream semantics)', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    // Settled prior turn so the wake arrives against an idle session — the
    // renderer-side shape of a wake landing after the page settles.
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '已注册监听' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    const bubblesBefore = container.querySelectorAll('.user-bubble').length
    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'watch-1', content: WATCH_WAKE }) })

    expect((await screen.findByTestId('subagent-signal-card')).getAttribute('data-signal-kind')).toBe('browser-watch')
    expect(container.querySelectorAll('.user-bubble')).toHaveLength(bubblesBefore)
    expect(container.querySelector('[data-user-prompt="watch-1"]')).toBeNull()
    expect(container.textContent).not.toContain('Do not treat this message as a new user request.')

    // From the renderer's perspective the wake behaves like any follow-up
    // user_message: the turn opens (busy) and settles back to idle. This
    // asserts UI busy/settle semantics only, not backend durable delivery.
    const wait = await screen.findByTestId('waiting-placeholder')
    expect(wait.getAttribute('data-phase')).toBe('continuing')
    expect(screen.getAllByLabelText('停止生成').length).toBeGreaterThan(0)

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(container.querySelector('[data-signal-kind="browser-watch"]')).toBeTruthy()
  })

  it('keeps ordinary typed prompts as human bubbles in the same session', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'human-1', content: '帮我盯住页面上出现的按钮' }) })
    await waitFor(() => expect(container.querySelector('[data-user-prompt="human-1"]')).toBeTruthy())
    expect(container.querySelectorAll('.user-bubble').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-signal-kind="browser-watch"]')).toBeNull()
  })
})
