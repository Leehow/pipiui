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

describe('settled turn stays idle after a late streaming status', () => {
  it('does not reopen the composer as busy when queue_update arrives after settle', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '打包结果回来了' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'streaming' }) })
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
    expect(screen.getByLabelText('消息输入框').getAttribute('placeholder')).toBe('给 PipiUI 发送消息…')
  })

  it('names a follow-up wait after prior assistant output instead of claiming first response', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = { ...base, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: '第一轮答复' }) })
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    const followUpWait = await screen.findByTestId('waiting-placeholder')
    expect(followUpWait.getAttribute('data-phase')).toBe('continuing')
    expect(followUpWait.textContent).toContain('等待模型响应')
  })
})
