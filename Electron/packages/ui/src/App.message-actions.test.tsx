// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, PipiHostAPI } from '@pipi/host-api'

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element }, ref) => { React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

import { App, createMockHost } from './App'
import { MessageView } from './Transcript'

let originalClipboard: PropertyDescriptor | undefined
beforeEach(() => {
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

function history(): HistoryEntry[] {
  return [
    { id: 'user-full', role: 'user', content: '完整原文 😀\n第二行', timestamp: 1 },
    { id: 'assistant-history', role: 'assistant', content: '助手历史消息', timestamp: 2 },
    { id: 'tool-history', role: 'tool', content: '工具历史消息', timestamp: 3 }
  ]
}

function hostWithHistory(overrides: Partial<PipiHostAPI> = {}) {
  const base = createMockHost()
  return { ...base, getSessionHistory: async (sessionId: string) => sessionId === 'welcome' ? history() : [], ...overrides } as PipiHostAPI
}

describe('App message actions', () => {
  it('shows a full date and time before right-aligned message actions', () => {
    const timestamp = new Date(2026, 7, 13, 0, 16).getTime()
    const onCopy = vi.fn(async () => undefined)
    const onResend = vi.fn()
    const { container } = render(<MessageView message={{ id: 'dated', role: 'assistant', content: 'dated message', timestamp }} showFooter onCopy={onCopy} onResend={onResend} resendDisabled={false} />)
    const footer = container.querySelector('.message-footer') as HTMLElement
    const time = within(footer).getByText(/2026.*08.*13.*00:16/)
    const toolbar = within(footer).getByRole('toolbar', { name: '消息操作' })
    expect(time.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toolbar.className).toContain('trailing')
  })

  it('copies the complete user source text and reports success', async () => {
    render(<App host={hostWithHistory()} />)
    await screen.findByText('完整原文 😀', { exact: false })
    const user = document.querySelector('[data-user-prompt="user-full"]') as HTMLElement
    fireEvent.click(within(user).getByRole('button', { name: '复制消息' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('完整原文 😀\n第二行'))
    // The copied notice lives inside the user message; the transcript tail can
    // host other role=status rows (e.g. a running-subagent indicator).
    expect(within(user).getByRole('status').textContent).toBe('已复制')
  })

  it('resends only user messages via the existing send path', async () => {
    const sendPrompt = vi.fn(async () => undefined)
    render(<App host={hostWithHistory({ sendPrompt })} />)
    await screen.findByText('完整原文 😀', { exact: false })
    const user = document.querySelector('[data-user-prompt="user-full"]') as HTMLElement
    fireEvent.click(within(user).getByRole('button', { name: '重发消息' }))
    await waitFor(() => expect(sendPrompt).toHaveBeenCalledWith('welcome', '完整原文 😀\n第二行'))
    await waitFor(() => expect(document.querySelectorAll('[data-user-prompt]').length).toBe(2))
    // Both resend controls belong to the historical and optimistic user messages;
    // assistant and tool rows never render one.
    expect(screen.getAllByRole('button', { name: '重发消息' }).length).toBe(2)
  })

  it('disables resend for a read-only lease', async () => {
    const host = hostWithHistory({ getSessionLease: async sessionId => ({ sessionId, writable: false }) })
    render(<App host={host} />)
    await screen.findByText('完整原文 😀', { exact: false })
    const user = document.querySelector('[data-user-prompt="user-full"]') as HTMLElement
    expect((within(user).getByRole('button', { name: '重发消息' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
