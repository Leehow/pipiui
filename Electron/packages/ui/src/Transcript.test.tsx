// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VirtuosoHandle } from 'react-virtuoso'
import { Transcript } from './Transcript'
import type { ChatMessage } from './transcript-model'

const virtuosoProps: { initialTopMostItemIndex?: number } = {}
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent, initialTopMostItemIndex }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element; initialTopMostItemIndex?: number }, ref) => {
    virtuosoProps.initialTopMostItemIndex = initialTopMostItemIndex
    React.useImperativeHandle(ref, () => ({ scrollToIndex: vi.fn() }))
    return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div>
  }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const handlers = { onCopy: vi.fn(async () => undefined), onResend: vi.fn(), resendDisabled: false, copiedId: null }
const messages: ChatMessage[] = [
  { id: 'a1', role: 'assistant', content: '上一轮已经写完。', timestamp: Date.parse('2026-08-14T22:07:00') }
]

describe('Transcript waiting layout', () => {
  it('starts Virtuoso at the newest message so a first open is not stuck at the oldest', () => {
    const transcriptRef = createRef<VirtuosoHandle>()
    const history: ChatMessage[] = [
      { id: 'old', role: 'user', content: '旧历史', timestamp: 1 },
      { id: 'new', role: 'assistant', content: '最新回复', timestamp: 2 },
    ]
    render(<Transcript messages={history} transcriptRef={transcriptRef} {...handlers} />)
    expect(virtuosoProps.initialTopMostItemIndex).toBe(1)
  })

  it('marks the transcript tail as waiting so CSS can lift the last message footer', () => {
    const transcriptRef = createRef<VirtuosoHandle>()
    const view = render(<Transcript messages={messages} transcriptRef={transcriptRef} {...handlers} />)
    expect(view.container.querySelector('.transcript-area')!.classList.contains('is-waiting')).toBe(false)

    view.rerender(<Transcript messages={messages} transcriptRef={transcriptRef} waiting={{ startedAt: Date.now(), phase: 'tool', detail: '1 个子任务执行中' }} {...handlers} />)
    const area = view.container.querySelector('.transcript-area')!
    expect(area.classList.contains('is-waiting')).toBe(true)
    expect(area.querySelector('[data-testid="waiting-placeholder"]')).toBeTruthy()
    expect(area.querySelector('.message-time')?.textContent).toContain('2026-08-14 22:07')
  })

  it('renders a collapsed compaction divider that expands to the summary', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const transcriptRef = createRef<VirtuosoHandle>()
    const history: ChatMessage[] = [
      { id: 'old', role: 'user', content: '压缩前', timestamp: 1 },
      { id: 'c1', role: 'compaction', content: '本轮摘要', timestamp: 2 },
      { id: 'new', role: 'assistant', content: '压缩后', timestamp: 3 },
      { id: 'c2', role: 'compaction', content: '', timestamp: 4 },
    ]
    const view = render(<Transcript messages={history} transcriptRef={transcriptRef} {...handlers} />)
    const dividers = view.container.querySelectorAll('[data-testid="compaction-divider"]')
    expect(dividers).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-testid="compaction-summary"]')).toHaveLength(0)
    expect(view.container.querySelector('[data-user-prompt="old"]')).toBeTruthy()
    fireEvent.click(dividers[0]!.querySelector('button')!)
    expect(view.container.querySelector('[data-testid="compaction-summary"]')?.textContent).toBe('本轮摘要')
    fireEvent.click(dividers[1]!.querySelector('button')!)
    expect(Array.from(view.container.querySelectorAll('[data-testid="compaction-summary"]')).map(node => node.textContent)).toEqual(['本轮摘要', '本次压缩未留下摘要。'])
  })
})
