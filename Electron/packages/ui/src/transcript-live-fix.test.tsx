// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
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
import { appendLiveUserMessage, type ChatMessage } from './transcript-model'
import { transcriptMessageIdentity, countTranscriptPrepended, nextTranscriptFirstItemIndex, TRANSCRIPT_FIRST_ITEM_BASE } from './transcript-scroll'
import { UserMessageBubble } from './UserMessageBubble'

beforeEach(() => { localStorage.clear(); Reflect.deleteProperty(window, 'pipiHost') })
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); Reflect.deleteProperty(window, 'pipiHost') })

describe('fix1: queue busy local echo + dedup', () => {
  it('appendLiveUserMessage merges queued optimistic via FIFO content match and clears queued flag', () => {
    const live: ChatMessage[] = [
      { id: 'q1', role: 'user', content: 'first queued', timestamp: 1, queued: true },
      { id: 'q2', role: 'user', content: 'second queued', timestamp: 2, queued: true },
    ]
    const afterFirstEcho = appendLiveUserMessage(live, { content: 'first queued', id: 'srv1' })
    expect(afterFirstEcho).toHaveLength(2)
    expect(afterFirstEcho[0]).toMatchObject({ id: 'srv1', content: 'first queued' })
    expect((afterFirstEcho[0] as ChatMessage).queued).toBeUndefined()
    expect(afterFirstEcho[1]).toMatchObject({ id: 'q2', queued: true })

    const afterSecondEcho = appendLiveUserMessage(afterFirstEcho, { content: 'second queued', id: 'srv2' })
    expect(afterSecondEcho[1]).toMatchObject({ id: 'srv2' })
    expect((afterSecondEcho[1] as ChatMessage).queued).toBeUndefined()
  })

  it('busy send shows optimistic bubble with 排队中 and dedups on host echo', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    const base = createMockHost()
    // Make busy by having streaming true after first started
    const host: PipiHostAPI = {
      ...base,
      enqueueMessage: async (_sessionId, text) => ({ outcome: 'queued', message: { id: 'queued-1', sessionId: 'layout', text, attachments: [], createdAt: Date.now(), state: 'queued' as const } }),
      listQueue: async () => [],
      subscribeStream: (_sid, cb) => { listener = cb; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    // Now queue busy
    const input = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'queued prompt text' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(screen.getByText('queued prompt text')).toBeTruthy())
    expect(screen.getByTestId('user-bubble-queued')).toBeTruthy()
    expect(screen.getByText('排队中')).toBeTruthy()

    // Host echo for queued prompt should dedup, not double
    act(() => { listener?.({ type: 'user_message', sessionId: 'layout', id: 'srv-queued-1', content: 'queued prompt text' }) })
    // Should still be one bubble, queued flag cleared
    const bubbles = screen.getAllByText('queued prompt text')
    expect(bubbles.length).toBe(1)
    expect(screen.queryByTestId('user-bubble-queued')).toBeNull()
  })
})

describe('fix2: turnClosed late events not dropped', () => {
  it('late text/tool after settled still appears and triggers immediate history refresh', async () => {
    let listener: ((event: StreamEvent) => void) | undefined
    let historyCalls = 0
    const base = createMockHost()
    const host: PipiHostAPI = {
      ...base,
      getSessionHistory: async (sid, before, limit) => {
        historyCalls++
        return base.getSessionHistory(sid, before, limit)
      },
      subscribeStream: (_sid, cb) => { listener = cb; return () => { listener = undefined } },
    }
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    fireEvent.click(container.querySelector('[data-session-id="layout"]')!)
    await waitFor(() => expect(listener).toBeDefined())

    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'started' }) })
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: 'early' }) })
    expect(screen.getByText('early')).toBeTruthy()
    act(() => { listener?.({ type: 'status', sessionId: 'layout', status: 'settled' }) })
    await waitFor(() => expect(screen.queryByLabelText('停止生成')).toBeNull())
    historyCalls = 0

    // Late delta after turnClosed should still apply immediately, not wait for 250ms
    act(() => { listener?.({ type: 'text', sessionId: 'layout', contentIndex: 0, delta: ' late-needs-show' }) })
    // Should be visible immediately
    expect(screen.getByText(/late-needs-show/)).toBeTruthy()
    // And history refresh should have been triggered immediately (count increased)
    await waitFor(() => expect(historyCalls).toBeGreaterThan(0))

    // Late tool_call also not dropped
    act(() => { listener?.({ type: 'tool_call', sessionId: 'layout', toolCallId: 'late-tool', name: 'read', delta: '{"path":"a"}' }) })
    expect(document.body.textContent).toContain('read')
  })
})

describe('fix3: identity stable across content streaming', () => {
  it('transcriptMessageIdentity does not change when content grows', () => {
    const a = transcriptMessageIdentity({ id: 'm1', role: 'assistant', timestamp: 1, content: 'hello' })
    const b = transcriptMessageIdentity({ id: 'm1', role: 'assistant', timestamp: 1, content: 'hello world long content that keeps growing during stream' })
    expect(a).toBe(b)
  })

  it('countTranscriptPrepended stays valid after streaming content change', () => {
    const newest = ['m1', 'm2'].map(id => transcriptMessageIdentity({ id, role: 'user', timestamp: 1, content: 'same' }))
    const streamed = ['m1', 'm2'].map(id => transcriptMessageIdentity({ id, role: 'user', timestamp: 1, content: 'updated content after stream delta' }))
    // Identities equal despite content change
    expect(newest).toEqual(streamed)
    const older = [transcriptMessageIdentity({ id: 'older', role: 'user', timestamp: 0, content: 'x' }), ...streamed]
    expect(countTranscriptPrepended(streamed, older)).toBe(1)
    expect(nextTranscriptFirstItemIndex(TRANSCRIPT_FIRST_ITEM_BASE, streamed, older)).toBe(TRANSCRIPT_FIRST_ITEM_BASE - 1)
  })

  it('UserMessageBubble shows queued badge when queued', () => {
    const { container } = render(<UserMessageBubble text='hello' queued />)
    expect(container.querySelector('[data-testid="user-bubble-queued"]')).toBeTruthy()
    expect(container.textContent).toContain('排队中')
    const { container: c2 } = render(<UserMessageBubble text='hello' />)
    expect(c2.querySelector('[data-testid="user-bubble-queued"]')).toBeNull()
  })
})
