// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VirtuosoHandle } from 'react-virtuoso'
import { Transcript } from './Transcript'
import type { ChatMessage } from './transcript-model'
import { TRANSCRIPT_FIRST_ITEM_BASE, transcriptTailVirtualIndex } from './transcript-scroll'

type VirtuosoCapture = {
  firstItemIndex?: number
  initialTopMostItemIndex?: unknown
  followOutput?: (atBottom: boolean) => unknown
  atBottomStateChange?: (value: boolean) => void
  computeItemKey?: (index: number, item: ChatMessage) => React.Key
  totalListHeightChanged?: (height: number) => void
  data: unknown[]
  handle: VirtuosoHandle
  scrollToIndex: ReturnType<typeof vi.fn>
}

const virtuosoInstances: VirtuosoCapture[] = []

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef((props: {
    data: unknown[]
    itemContent: (index: number, item: never) => JSX.Element
    initialTopMostItemIndex?: unknown
    firstItemIndex?: number
    followOutput?: (atBottom: boolean) => unknown
    atBottomStateChange?: (value: boolean) => void
    computeItemKey?: (index: number, item: ChatMessage) => React.Key
    totalListHeightChanged?: (height: number) => void
  }, ref) => {
    const rec = React.useRef<VirtuosoCapture>()
    if (!rec.current) {
      const scrollToIndex = vi.fn()
      rec.current = { scrollToIndex, handle: { scrollToIndex } as unknown as VirtuosoHandle, data: props.data }
      virtuosoInstances.push(rec.current)
    }
    rec.current.firstItemIndex = props.firstItemIndex
    rec.current.initialTopMostItemIndex = props.initialTopMostItemIndex
    rec.current.followOutput = props.followOutput
    rec.current.atBottomStateChange = props.atBottomStateChange
    rec.current.computeItemKey = props.computeItemKey
    rec.current.totalListHeightChanged = props.totalListHeightChanged
    rec.current.data = props.data
    React.useImperativeHandle(ref, () => rec.current!.handle, [])
    return <div>{props.data.map((item, index) => <React.Fragment key={index}>{props.itemContent(index, item as never)}</React.Fragment>)}</div>
  }) }
})
vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))
vi.mock('@xterm/xterm', () => ({ Terminal: class { open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); buffer = { active: { viewportY: 0, baseY: 0 } }; onData = () => ({ dispose: vi.fn() }); onScroll = () => ({ dispose: vi.fn() }) } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => { cleanup(); virtuosoInstances.length = 0; vi.restoreAllMocks() })

const handlers = { onCopy: vi.fn(async () => undefined), onResend: vi.fn(), resendDisabled: false, copiedId: null }
const messages: ChatMessage[] = [
  { id: 'a1', role: 'assistant', content: '上一轮已经写完。', timestamp: Date.parse('2026-08-14T22:07:00') }
]

function makeMessages(count: number, start = 0): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${start + index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `msg ${start + index}`,
    timestamp: start + index,
  } satisfies ChatMessage))
}

async function flushPin(frames = 5) {
  await act(async () => {
    for (let frame = 0; frame < frames; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
  })
}

describe('Transcript waiting layout', () => {
  it('starts Virtuoso at the newest message so a first open is not stuck at the oldest', () => {
    const transcriptRef = createRef<VirtuosoHandle>()
    const history: ChatMessage[] = [
      { id: 'old', role: 'user', content: '旧历史', timestamp: 1 },
      { id: 'new', role: 'assistant', content: '最新回复', timestamp: 2 },
    ]
    render(<Transcript messages={history} transcriptRef={transcriptRef} {...handlers} />)
    expect(virtuosoInstances[0]?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' })
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

describe('Transcript prepend and follow', () => {
  it('holds firstItemIndex still for a tail append and lowers it on an older-page prepend', () => {
    const transcriptRef = createRef<VirtuosoHandle>()
    const newest = makeMessages(4, 4)
    const view = render(<Transcript messages={newest} transcriptRef={transcriptRef} {...handlers} />)
    const first = virtuosoInstances[0]!.firstItemIndex
    expect(first).toBe(TRANSCRIPT_FIRST_ITEM_BASE)
    expect(virtuosoInstances[0]!.computeItemKey?.(first! + 3, newest[3]!)).toBe(`${first! + 3}:m7`)

    const full = [...makeMessages(4, 0), ...newest]
    view.rerender(<Transcript messages={full} transcriptRef={transcriptRef} {...handlers} />)
    expect(virtuosoInstances[0]!.firstItemIndex).toBe(first! - 4)
    expect(transcriptTailVirtualIndex(virtuosoInstances[0]!.firstItemIndex!, full.length)).toBe(transcriptTailVirtualIndex(first!, newest.length))

    view.rerender(<Transcript messages={[...full, makeMessages(1, 8)[0]!]} transcriptRef={transcriptRef} {...handlers} />)
    expect(virtuosoInstances[0]!.firstItemIndex).toBe(first! - 4)
  })

  it('keeps duplicate host ids uniquely keyed and stable across a prepend', () => {
    const duplicateA: ChatMessage = { id: 'duplicate', role: 'user', content: 'first duplicate', timestamp: 101 }
    const duplicateB: ChatMessage = { id: 'duplicate', role: 'assistant', content: 'second duplicate', timestamp: 102 }
    const view = render(<Transcript messages={[duplicateA, duplicateB]} {...handlers} />)
    const instance = virtuosoInstances[0]!
    const first = instance.firstItemIndex!
    const keyA = instance.computeItemKey?.(first, duplicateA)
    const keyB = instance.computeItemKey?.(first + 1, duplicateB)
    expect(keyA).not.toBe(keyB)

    const older: ChatMessage = { id: 'duplicate', role: 'assistant', content: 'older duplicate', timestamp: 100 }
    view.rerender(<Transcript messages={[older, duplicateA, duplicateB]} {...handlers} />)
    expect(instance.firstItemIndex).toBe(first - 1)
    expect(instance.computeItemKey?.(instance.firstItemIndex! + 1, duplicateA)).toBe(keyA)
    expect(instance.computeItemKey?.(instance.firstItemIndex! + 2, duplicateB)).toBe(keyB)
  })

  it('ignores a hidden-slot stale true until the activation generation has issued LAST', async () => {
    const transcriptRef = createRef<VirtuosoHandle>()
    const first = makeMessages(3, 0)
    const view = render(<Transcript active={false} messages={first} transcriptRef={transcriptRef} {...handlers} />)
    expect(virtuosoInstances[0]!.scrollToIndex).not.toHaveBeenCalled()

    view.rerender(<Transcript active messages={first} transcriptRef={transcriptRef} {...handlers} />)
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    expect(virtuosoInstances[0]!.scrollToIndex).not.toHaveBeenCalled()
    await waitFor(() => expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' }))

    const issuedCalls = virtuosoInstances[0]!.scrollToIndex.mock.calls.length
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    await flushPin()
    expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledTimes(issuedCalls)
    expect(virtuosoInstances[0]!.followOutput?.(false)).toBe('auto')
  })

  it('pins after every page in a run of consecutive history prepends and ends at LAST', async () => {
    const transcriptRef = createRef<VirtuosoHandle>()
    const newest = makeMessages(3, 6)
    const view = render(<Transcript active messages={newest} transcriptRef={transcriptRef} {...handlers} />)
    await flushPin()
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(false))
    virtuosoInstances[0]!.scrollToIndex.mockClear()

    const pageTwo = [...makeMessages(3, 3), ...newest]
    view.rerender(<Transcript active messages={pageTwo} transcriptRef={transcriptRef} {...handlers} />)
    await flushPin()
    expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' })
    virtuosoInstances[0]!.scrollToIndex.mockClear()

    const full = [...makeMessages(3, 0), ...pageTwo]
    view.rerender(<Transcript active messages={full} transcriptRef={transcriptRef} {...handlers} />)
    await waitFor(() => expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' }))
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    expect(virtuosoInstances[0]!.firstItemIndex).toBe(TRANSCRIPT_FIRST_ITEM_BASE - 6)
  })

  it('keeps independent handles for keep-alive slots and cancels the losing slot on rapid switches', async () => {
    const activeBridge = createRef<VirtuosoHandle>()
    const sessionA = makeMessages(3, 0)
    const sessionB = makeMessages(3, 10)
    const view = render(
      <>
        <Transcript active messages={sessionA} transcriptRef={activeBridge} {...handlers} />
        <Transcript active={false} messages={sessionB} transcriptRef={activeBridge} {...handlers} />
      </>
    )
    expect(virtuosoInstances[0]!.handle).not.toBe(virtuosoInstances[1]!.handle)
    expect(activeBridge.current).toBe(virtuosoInstances[0]!.handle)
    virtuosoInstances.forEach(instance => instance.scrollToIndex.mockClear())

    view.rerender(
      <>
        <Transcript active={false} messages={sessionA} transcriptRef={activeBridge} {...handlers} />
        <Transcript active messages={sessionB} transcriptRef={activeBridge} {...handlers} />
      </>
    )
    expect(activeBridge.current).toBe(virtuosoInstances[1]!.handle)
    act(() => virtuosoInstances[1]!.atBottomStateChange?.(true))
    view.rerender(
      <>
        <Transcript active messages={sessionA} transcriptRef={activeBridge} {...handlers} />
        <Transcript active={false} messages={sessionB} transcriptRef={activeBridge} {...handlers} />
      </>
    )
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    await waitFor(() => expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' }))
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    await flushPin()
    expect(activeBridge.current).toBe(virtuosoInstances[0]!.handle)
    expect(virtuosoInstances[1]!.scrollToIndex).not.toHaveBeenCalled()
  })

  it('does not let a programmatic atBottom=false close a new follow round', async () => {
    const first = makeMessages(3, 0)
    const view = render(<Transcript active messages={first} {...handlers} />)
    await flushPin()
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(false))
    expect(virtuosoInstances[0]!.followOutput?.(false)).toBe('auto')
    virtuosoInstances[0]!.scrollToIndex.mockClear()

    view.rerender(<Transcript active messages={[...first, makeMessages(1, 3)[0]!]} {...handlers} />)
    await waitFor(() => expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' }))
  })

  it('only detaches for a cumulative, vertically dominant downward touch', async () => {
    const view = render(<Transcript active messages={makeMessages(3)} {...handlers} />)
    await flushPin()
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    const area = view.container.querySelector('.transcript-area')!

    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchMove(area, { touches: [{ clientX: 101, clientY: 82 }] })
    expect(virtuosoInstances[0]!.followOutput?.(true)).toBe('auto')

    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchMove(area, { touches: [{ clientX: 120, clientY: 107 }] })
    fireEvent.touchMove(area, { touches: [{ clientX: 126, clientY: 115 }] })
    expect(virtuosoInstances[0]!.followOutput?.(true)).toBe('auto')

    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 100 }] })
    fireEvent.touchMove(area, { touches: [{ clientX: 102, clientY: 108 }] })
    expect(virtuosoInstances[0]!.followOutput?.(true)).toBe('auto')
    fireEvent.touchMove(area, { touches: [{ clientX: 103, clientY: 115 }] })
    expect(virtuosoInstances[0]!.followOutput?.(true)).toBe(false)
  })

  it('stops pinning only for real upward user intent and resumes from 回到最新', async () => {
    const first = makeMessages(3, 0)
    const view = render(<Transcript active messages={first} {...handlers} />)
    await flushPin()
    fireEvent.wheel(view.container.querySelector('.transcript-area')!, { deltaY: -20 })
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(true))
    expect(virtuosoInstances[0]!.followOutput?.(true)).toBe(false)
    act(() => virtuosoInstances[0]!.atBottomStateChange?.(false))
    virtuosoInstances[0]!.scrollToIndex.mockClear()

    const prepended = [...makeMessages(2, 10), ...first]
    view.rerender(<Transcript active messages={prepended} {...handlers} />)
    act(() => virtuosoInstances[0]!.totalListHeightChanged?.(900))
    await flushPin()
    expect(virtuosoInstances[0]!.scrollToIndex).not.toHaveBeenCalled()
    expect(virtuosoInstances[0]!.followOutput?.(false)).toBe(false)

    fireEvent.click(view.getByRole('button', { name: '回到最新' }))
    await waitFor(() => expect(virtuosoInstances[0]!.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'auto' }))
    expect(virtuosoInstances[0]!.followOutput?.(false)).toBe('auto')
  })
})
