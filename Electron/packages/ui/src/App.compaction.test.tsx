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

/** Renders App with an injected stream listener and returns it once subscribed. */
async function mount(overrides: Partial<PipiHostAPI> = {}) {
  let listener: ((event: StreamEvent) => void) | undefined
  const base = createMockHost()
  const host: PipiHostAPI = { ...base, ...overrides, subscribeStream: (_sessionId, callback) => { listener = callback; return () => { listener = undefined } } }
  render(<App host={host} />)
  await screen.findAllByText('Electron 三栏界面')
  await waitFor(() => expect(listener).toBeDefined())
  return { host, emit: (event: StreamEvent) => act(() => { listener?.(event) }) }
}

const composer = () => screen.getByPlaceholderText(/给 PipiUI 发送消息/)

describe('context compaction', () => {
  it('narrates the lifecycle in the transcript and shows the pill indicator', async () => {
    const { emit } = await mount()

    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', reason: 'threshold' })
    expect(await screen.findByText('正在压缩上下文…（上下文超限）')).toBeTruthy()
    expect((await screen.findByTestId('stats-compacting')).textContent).toContain('压缩中')
    expect(screen.getByLabelText('停止生成')).toBeTruthy()

    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', reason: 'threshold' })
    expect(await screen.findByText('上下文压缩完成')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('stats-compacting')).toBeNull())
    expect(screen.queryByLabelText('停止生成')).toBeNull()
  })

  it('reports a failed compaction instead of silently doing nothing', async () => {
    const { emit } = await mount()
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', reason: 'overflow' })
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', reason: 'overflow', error: 'summarizer timed out' })
    expect(await screen.findByText('上下文压缩失败：summarizer timed out')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('stats-compacting')).toBeNull())
  })

  it('runs /compact through the host instead of sending it as a prompt', async () => {
    const compact = vi.fn(async () => undefined)
    const sendPrompt = vi.fn(async () => undefined)
    await mount({ compact, sendPrompt })

    fireEvent.change(composer(), { target: { value: '/compact' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    await waitFor(() => expect(compact).toHaveBeenCalledWith('welcome'))
    expect(sendPrompt).not.toHaveBeenCalled()
    // Swift's executeSlash clears the draft before running the command.
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe(''))
  })

  it('surfaces a refused /compact, which produces no lifecycle events', async () => {
    const compact = vi.fn(async () => { throw new Error('Nothing to compact (session too small)') })
    await mount({ compact })

    fireEvent.change(composer(), { target: { value: '/compact' } })
    fireEvent.keyDown(composer(), { key: 'Enter' })

    expect(await screen.findByText(/上下文压缩失败：Nothing to compact/)).toBeTruthy()
  })
})
