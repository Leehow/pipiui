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

describe('active-turn waiting placeholder', () => {
  it('folds a host-driven turn (resumed/read-only session) once it settles', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())

    // A host-driven turn (not started by a UI send) streams…
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'started' }) })
    act(() => { listener?.({ type: 'tool_call', sessionId: 'welcome', toolCallId: 'bash-1', name: 'bash', delta: '{"command":"ls -la"}' }) })
    act(() => { listener?.({ type: 'tool_result', sessionId: 'welcome', toolCallId: 'bash-1', content: 'ok', isError: false }) })
    const outer = await screen.findByRole('button', { name: /1 个步骤/ })
    expect(outer.getAttribute('aria-expanded')).toBe('true')

    // …and folds when the turn settles, even without a direct user send.
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.getByRole('button', { name: /1 个步骤/ }).getAttribute('aria-expanded')).toBe('false'))
  })

  it('only starts for a user send, hides on first assistant event, and stop uses host.stop', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const stop = vi.fn(async () => listener?.({ type: 'status', sessionId: 'welcome', status: 'stopped' }))
    const host: PipiHostAPI = { ...base, sendPrompt: vi.fn(async () => undefined), stop, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(listener).toBeDefined())
    const input = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    const send = screen.getByLabelText('发送消息') as HTMLButtonElement
    await waitFor(() => expect(input.disabled).toBe(false), { timeout: 5000 })

    // A queue/status update is not a user turn and must not create a placeholder.
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'started', pendingFollowUps: ['queued'] }) })
    expect(screen.queryByTestId('waiting-placeholder')).toBeNull()
    // The observed host turn is busy but not ours; once it settles, the next
    // user turn remains a direct send and gets its own waiting indicator.
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.getByLabelText('发送消息')).toBeTruthy(), { timeout: 5000 })

    fireEvent.change(input, { target: { value: 'hello' } })
    const directSend = screen.getByLabelText('发送消息') as HTMLButtonElement
    await waitFor(() => expect(directSend.disabled).toBe(false), { timeout: 5000 })
    fireEvent.click(directSend)
    expect(await screen.findByTestId('waiting-placeholder')).toBeTruthy()

    act(() => { listener?.({ type: 'thinking', sessionId: 'welcome', contentIndex: 0, delta: 'thinking' }) })
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())

    // End the first turn, start another, and verify the inline stop delegates to the existing API.
    act(() => { listener?.({ type: 'status', sessionId: 'welcome', status: 'settled' }) })
    await waitFor(() => expect(screen.getByLabelText('发送消息')).toBeTruthy())
    fireEvent.change(input, { target: { value: 'again' } })
    fireEvent.click(screen.getByLabelText('发送消息'))
    fireEvent.click(await screen.findByTestId('waiting-stop'))
    await waitFor(() => expect(stop).toHaveBeenCalledWith('welcome'))
    await waitFor(() => expect(screen.queryByTestId('waiting-placeholder')).toBeNull())
  })
})
