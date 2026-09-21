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

/** Every tool/system line the transcript currently shows. */
function transcriptNotices(): string[] {
  return Array.from(document.querySelectorAll('.tool-message, .system-message'))
    .map(node => (node.textContent ?? '').trim())
    .filter(Boolean)
}

describe('context compaction', () => {
  it('shows the pill while compacting and one specific completion line — no start/end duplicate', async () => {
    const { emit } = await mount()

    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', reason: 'threshold', operation: 'context_compaction', trigger: 'near_overflow', executed: true })
    // In-progress state lives in the pill only; the start adds no transcript line.
    expect(await screen.findByTestId('stats-compacting')).toBeTruthy()
    await waitFor(() => expect((screen.getByTestId('stats-compacting') as HTMLElement).textContent).toContain('临近上限'))
    expect(transcriptNotices().some(text => text.includes('正在压缩'))).toBe(false)
    expect(screen.getByLabelText('停止生成')).toBeTruthy()

    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', reason: 'threshold', operation: 'context_compaction', trigger: 'near_overflow', executed: true })
    expect(await screen.findByText('上下文压缩完成（临近上下文上限保护）')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('stats-compacting')).toBeNull())
    expect(screen.queryByLabelText('停止生成')).toBeNull()
    // Exactly one transcript line for the whole lifecycle.
    expect(transcriptNotices().filter(text => text.includes('上下文压缩完成'))).toHaveLength(1)
  })

  it('labels the scheduler\'s idle compaction and pi\'s other triggers distinctly', async () => {
    const { emit } = await mount()

    // The host scheduler issues the same compact RPC as /compact; only the
    // trigger field separates 空闲自动压缩 from 手动压缩.
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', reason: 'manual', operation: 'context_compaction', trigger: 'proactive_idle', executed: true })
    await waitFor(() => expect((screen.getByTestId('stats-compacting') as HTMLElement).textContent).toContain('空闲自动'))
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', reason: 'manual', operation: 'context_compaction', trigger: 'proactive_idle', executed: true })
    expect(await screen.findByText('上下文压缩完成（空闲自动压缩：上下文≥65%且连续空闲4分钟）')).toBeTruthy()
  })

  it('falls back to 自动压缩 for legacy events without trigger fields', async () => {
    const { emit } = await mount()
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', reason: 'threshold' })
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', reason: 'threshold' })
    expect(await screen.findByText('上下文压缩完成（自动压缩）')).toBeTruthy()
  })

  it('reports a failed compaction instead of silently doing nothing', async () => {
    const { emit } = await mount()
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', reason: 'overflow', operation: 'context_compaction', trigger: 'overflow', executed: true })
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', reason: 'overflow', operation: 'context_compaction', trigger: 'overflow', error: 'summarizer timed out', executed: true })
    expect(await screen.findByText('上下文压缩失败：summarizer timed out')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('stats-compacting')).toBeNull())
  })

  it('never writes a transcript line for notice-only (check/nudge/skip) events', async () => {
    const { emit } = await mount()
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', executed: false, skipReason: '上下文低于65%' })
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'start', executed: false })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(transcriptNotices().some(text => text.includes('压缩') || text.includes('已检查'))).toBe(false)
    expect(screen.queryByTestId('stats-compacting')).toBeNull()
  })

  it('labels a deterministic idle fold as 整理, not 压缩', async () => {
    const { emit } = await mount()
    emit({ type: 'compaction', sessionId: 'welcome', phase: 'end', operation: 'context_fold', trigger: 'idle_fold', executed: true })
    expect(await screen.findByText('上下文已折叠整理（空闲自动折叠）')).toBeTruthy()
    expect(transcriptNotices().some(text => text.includes('上下文已压缩'))).toBe(false)
    expect(screen.queryByTestId('stats-compacting')).toBeNull()
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
