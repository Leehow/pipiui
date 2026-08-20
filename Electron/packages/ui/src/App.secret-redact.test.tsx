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

const FAKE = 'vault-test-secret-AAAA'

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

describe('secret_redact replaces the live user bubble', () => {
  it('hides the fake value after generation-end redact without reopening the turn', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async sessionId => sessionId === 'layout'
        ? [
            { id: 'u-hex', role: 'user', content: `再给你 ${FAKE}`, timestamp: 1 },
            { id: 'a-hex', role: 'assistant', content: `echo ${FAKE}`, timestamp: 2 },
          ]
        : base.getSessionHistory(sessionId),
      subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    await waitFor(() => expect(container.querySelector('[data-session-id="layout"]')).toBeTruthy())
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())
    await screen.findByText(`再给你 ${FAKE}`)

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    act(() => {
      listener?.({
        type: 'secret_redact',
        sessionId: 'layout',
        messages: [
          { id: 'u-hex', role: 'user', content: '再给你 {{secret:CSTCLOUD_API_KEY}}' },
          { id: 'a-hex', role: 'assistant', content: 'echo {{secret:CSTCLOUD_API_KEY}}' },
        ],
      })
    })

    await waitFor(() => expect(screen.getByText('再给你 [CSTCLOUD_API_KEY]')).toBeTruthy())
    expect(screen.queryByText(FAKE)).toBeNull()
    expect(screen.queryByText(/\{\{secret:CSTCLOUD_API_KEY\}\}/)).toBeNull()
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    expect(screen.getByLabelText('发送消息')).toBeTruthy()
  })
})
