// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '@pipi/host-api'
import { App, createMockHost } from './App'
import { PromptRail, useActivePromptId } from './PromptRail'
import {
  buildRailPrompts,
  isNavigationEligibleUserPrompt,
  isRuntimeOrSystemInjectedUserText,
  promptSummaryText,
  RAIL_TOOLTIP_MAX_LENGTH
} from './prompt-rail'
import type { RailPrompt } from './prompt-rail'

const virtuosoHarness = { atBottom: undefined as undefined | ((value: boolean) => void), scrollToIndex: vi.fn() }
vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return { Virtuoso: React.forwardRef(({ data, itemContent, atBottomStateChange }: { data: unknown[]; itemContent: (index: number, item: never) => JSX.Element; atBottomStateChange?: (value: boolean) => void }, ref) => { virtuosoHarness.atBottom = atBottomStateChange; React.useImperativeHandle(ref, () => ({ scrollToIndex: virtuosoHarness.scrollToIndex })); return <div>{data.map((item, index) => <React.Fragment key={index}>{itemContent(index, item as never)}</React.Fragment>)}</div> }) }
})

vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('@streamdown/code', () => ({ code: {} }))

/** Minimal IntersectionObserver stand-in so the active-prompt viewport logic is drivable. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  targets = new Set<Element>()
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
  emit(target: Element, isIntersecting: boolean) {
    this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  MockIntersectionObserver.instances.length = 0
  virtuosoHarness.scrollToIndex.mockClear()
})

// ---------------------------------------------------------------------------
// Message classification (mirrors Swift isNavigationEligibleHumanPrompt)
// ---------------------------------------------------------------------------

describe('prompt-rail message classification', () => {
  // Mixed fixture: system/tool/assistant + runtime-injected user-role signals
  // + real human prompts (including an empty-content image-only prompt).
  const fixture = [
    { id: 'sys', role: 'system', content: 'system policy' },
    { id: 'asst', role: 'assistant', content: '我会先检查现有结构。' },
    { id: 'tool', role: 'tool', content: 'read: package.json' },
    { id: 'hb', role: 'user', content: '[subagent-heartbeat] outstanding=1 vanished=0' },
    { id: 'done', role: 'user', content: '[subagent-done] agentId=w1 name=worker ok=true' },
    { id: 'stalled', role: 'user', content: '[subagent-stalled] agentId=w1 idle=120s' },
    { id: 'interrupt', role: 'user', content: '[subagent-interrupted-reminder] agentId=w2 state=interrupted nudge=1/2' },
    { id: 'worktree', role: 'user', content: '[worktree-merge-failed] agentId=w1 branch=x' },
    { id: 'postmerge', role: 'user', content: '[post-merge-verify-failed] agentId=w1 branch=x' },
    { id: 'git', role: 'user', content: '## Git (Pipi UI)\nbranch: main\ndirty: no' },
    { id: 'policy', role: 'user', content: '[PipiUI session skill policy: opt-in only.]' },
    { id: 'title', role: 'user', content: '[PipiUI internal — session title] generate title' },
    { id: 'redeliver', role: 'user', content: '(re-delivery #1: the previous [subagent-done] below was not confirmed)' },
    { id: 'recovered', role: 'user', content: '(recovered delivery of the previous [subagent-done])' },
    { id: 'u1', role: 'user', content: '第一问：修导航' },
    { id: 'u2', role: 'user', content: '带图提问' },
    { id: 'u3', role: 'user', content: '' } // image-only prompt stays eligible (Swift parity)
  ]

  it('keeps only real human user prompts from the mixed fixture', () => {
    expect(fixture.filter(isNavigationEligibleUserPrompt).map(m => m.id)).toEqual(['u1', 'u2', 'u3'])
  })

  it('builds rail nodes with transcript indices and plain summaries', () => {
    const prompts = buildRailPrompts(fixture)
    expect(prompts.map(p => p.id)).toEqual(['u1', 'u2', 'u3'])
    expect(prompts.map(p => p.index)).toEqual([14, 15, 16])
    expect(prompts.map(p => p.summary)).toEqual(['第一问：修导航', '带图提问', ''])
  })

  it('prefers structured kind/source metadata when the host provides it', () => {
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', kind: 'subagent-done' })).toBe(false)
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', source: 'host' })).toBe(false)
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', source: 'system' })).toBe(false)
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: 'hello', kind: 'user' })).toBe(true)
    // The content fallback still applies even with benign metadata.
    expect(isNavigationEligibleUserPrompt({ id: 'x', role: 'user', content: '[subagent-done] x', kind: 'user' })).toBe(false)
  })

  it('exposes the Swift runtime-injection prefix families', () => {
    expect(isRuntimeOrSystemInjectedUserText('[subagent-done] x')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('[PipiUI internal — session title] x')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('## Git (Pipi UI)\nbranch: main')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('(re-delivery #1 …)')).toBe(true)
    expect(isRuntimeOrSystemInjectedUserText('normal prompt')).toBe(false)
    expect(isRuntimeOrSystemInjectedUserText('')).toBe(false)
  })

  it('strips markdown, collapses whitespace, and truncates summaries', () => {
    expect(promptSummaryText('**bold** and `code` and [link](https://x)')).toBe('bold and code and link')
    expect(promptSummaryText('# Header\n\n- item one\n- item two')).toBe('Header item one item two')
    expect(promptSummaryText('a\n\n  b\t c')).toBe('a b c')
    expect(promptSummaryText('')).toBe('')
    const long = 'x'.repeat(200)
    const summary = promptSummaryText(long)
    expect(Array.from(summary)).toHaveLength(RAIL_TOOLTIP_MAX_LENGTH + 1)
    expect(summary.endsWith('…')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PromptRail view
// ---------------------------------------------------------------------------

describe('PromptRail', () => {
  const prompts: RailPrompt[] = [
    { id: 'u1', index: 0, summary: '第一问：修导航' },
    { id: 'u2', index: 5, summary: '第二问：修复提示词导航' },
    { id: 'u3', index: 9, summary: '' } // empty summary → ordinal fallback
  ]

  it('renders one small tick per prompt with ordinal labels', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    const ticks = screen.getAllByRole('button')
    expect(ticks).toHaveLength(3)
    expect(screen.getByRole('button', { name: '用户输入 1/3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '用户输入 3/3' })).toBeTruthy()
  })

  it('hides entirely when there are no user prompts', () => {
    const { container } = render(<PromptRail prompts={[]} activeId={null} onJump={vi.fn()} />)
    expect(container.querySelector('.prompt-rail')).toBeNull()
  })

  it('stays navigable but low-interference with a single prompt', () => {
    render(<PromptRail prompts={[{ id: 'u1', index: 2, summary: 'only' }]} activeId="u1" onJump={vi.fn()} />)
    const tick = screen.getByRole('button', { name: '用户输入 1/1' })
    expect(tick.getAttribute('data-active')).toBe('true')
    fireEvent.click(tick)
  })

  it('highlights only the active prompt', () => {
    render(<PromptRail prompts={prompts} activeId="u2" onJump={vi.fn()} />)
    const active = screen.getByRole('button', { name: '用户输入 2/3' })
    expect(active.getAttribute('data-active')).toBe('true')
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: '用户输入 1/3' }).getAttribute('data-active')).toBeNull()
    expect(screen.getByRole('button', { name: '用户输入 3/3' }).getAttribute('data-active')).toBeNull()
  })

  it('shows a summary tooltip on hover and hides it on leave', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    const second = screen.getByRole('button', { name: '用户输入 2/3' })
    fireEvent.mouseEnter(second)
    expect(screen.getByTestId('prompt-rail-tooltip').textContent).toBe('第二问：修复提示词导航')
    expect(second.getAttribute('aria-describedby')).toBe('prompt-rail-tooltip')
    fireEvent.mouseLeave(second)
    expect(screen.queryByTestId('prompt-rail-tooltip')).toBeNull()
  })

  it('shows the tooltip on keyboard focus and falls back to an image label for empty summaries', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    const third = screen.getByRole('button', { name: '用户输入 3/3' })
    fireEvent.focus(third)
    expect(screen.getByTestId('prompt-rail-tooltip').textContent).toBe('图片消息')
    expect(third.getAttribute('aria-describedby')).toBe('prompt-rail-tooltip')
    fireEvent.blur(third)
    expect(screen.queryByTestId('prompt-rail-tooltip')).toBeNull()
  })

  it('jumps to the transcript index of the clicked prompt', () => {
    const onJump = vi.fn()
    render(<PromptRail prompts={prompts} activeId={null} onJump={onJump} />)
    fireEvent.click(screen.getByRole('button', { name: '用户输入 2/3' }))
    expect(onJump).toHaveBeenCalledWith(5, 'u2')
  })

  it('lays out many prompts as a compact fixed-pitch list, not absolute message offsets', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, index: i, summary: `prompt ${i}` }))
    const { container } = render(<PromptRail prompts={many} activeId={null} onJump={vi.fn()} />)
    const rail = screen.getByTestId('prompt-rail')
    const scroll = container.querySelector('.prompt-rail-scroll')
    const ticks = container.querySelectorAll('.prompt-rail-tick')
    expect(ticks).toHaveLength(20)
    // Compact list: ticks are flow siblings inside the scroll container with no
    // per-tick absolute top/left (no message-offset spreading).
    for (const tick of ticks) expect(tick.getAttribute('style')).toBeNull()
    expect(scroll?.children).toHaveLength(20)
    expect(ticks[0].parentElement?.className).toContain('prompt-rail-scroll')
    // Swift-density pitch drives the layout without widening the rail.
    expect(rail.getAttribute('style')).toContain('--rail-pitch: 8px')
  })

  it('renders a wide horizontal summary card with the full cleaned summary', () => {
    const longSummary = '修复左侧导航 rail 与悬浮摘要卡。'.repeat(4)
    render(<PromptRail prompts={[{ id: 'u1', index: 0, summary: longSummary }]} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '用户输入 1/1' }))
    const tip = screen.getByTestId('prompt-rail-tooltip')
    expect(tip.className).toContain('prompt-rail-tooltip')
    // Full summary is present in the DOM; wrapping/ellipsis is purely visual.
    expect(tip.textContent).toBe(longSummary)
    // Explicit width (not shrink-to-fit) so CJK never collapses into one-char lines.
    const css = readFileSync(join(__dirname, 'prompt-rail.css'), 'utf8')
    expect(css).toContain('width:clamp(220px, 30vw, 320px)')
    expect(css).toContain('min-width:220px')
    expect(css).toContain('-webkit-line-clamp:3')
    expect(css).toContain('max-height:min(70vh, calc(100dvh - 96px))')
    expect(css).not.toContain('max-height:240px')
    // A 900px desktop viewport exposes a 630px rail — not a short 240px block.
    expect(Math.min(900 * 0.7, 900 - 96)).toBeGreaterThan(500)
    expect(css).not.toContain('border-radius:50%')
  })

  it('positions the tooltip beside its tick using compact-list offsets', () => {
    render(<PromptRail prompts={prompts} activeId={null} onJump={vi.fn()} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '用户输入 2/3' }))
    // RAIL_TICK_PADDING(1) + index(1)*pitch(8) + pitch/2(4) = 13px, no scroll.
    expect(screen.getByTestId('prompt-rail-tooltip').getAttribute('style')).toContain('--tip-top: 13px')
  })
})

// ---------------------------------------------------------------------------
// useActivePromptId (viewport-derived "current" marker)
// ---------------------------------------------------------------------------

describe('useActivePromptId', () => {
  function Harness({ atBottom }: { atBottom: boolean }) {
    const messages = [
      { id: 'u1', role: 'user', content: 'first' },
      { id: 'u2', role: 'user', content: 'second' }
    ]
    const prompts = useMemo(() => buildRailPrompts(messages), [])
    const { activeId, containerRef } = useActivePromptId(prompts, atBottom)
    return <div ref={containerRef} data-testid="harness">
      <div data-user-prompt="u1" data-user-index={0} />
      <div data-user-prompt="u2" data-user-index={1} />
      <span data-testid="active-id">{activeId ?? 'none'}</span>
    </div>
  }

  beforeEach(() => { vi.stubGlobal('IntersectionObserver', MockIntersectionObserver) })

  it('treats the latest user prompt as current while live', async () => {
    render(<Harness atBottom />)
    await waitFor(() => expect(screen.getByTestId('active-id').textContent).toBe('u2'))
  })

  it('tracks the bottom-most visible user prompt while browsing history', async () => {
    render(<Harness atBottom={false} />)
    await waitFor(() => expect(MockIntersectionObserver.instances.length).toBe(1))
    const io = MockIntersectionObserver.instances[0]
    const el = (id: string) => [...io.targets].find(t => t.getAttribute('data-user-prompt') === id)!
    const u1 = el('u1')
    const u2 = el('u2')

    io.emit(u2, true)
    await waitFor(() => expect(screen.getByTestId('active-id').textContent).toBe('u2'))
    io.emit(u2, false)
    io.emit(u1, true)
    await waitFor(() => expect(screen.getByTestId('active-id').textContent).toBe('u1'))
  })
})

// ---------------------------------------------------------------------------
// Integration: App wiring with the mixed fixture
// ---------------------------------------------------------------------------

describe('PromptRail integration in App', () => {
  const mixedHistory: HistoryEntry[] = [
    { id: 's1', role: 'assistant', content: '我会先检查现有结构。', timestamp: 1 },
    { id: 'u1', role: 'user', content: '请实现导航 rail', timestamp: 2 },
    { id: 'hb', role: 'user', content: '[subagent-heartbeat] outstanding=1 vanished=0', timestamp: 3 },
    { id: 't1', role: 'tool', content: 'read: package.json', timestamp: 4 },
    { id: 'a1', role: 'assistant', content: '正在实现…', timestamp: 5 },
    { id: 'done', role: 'user', content: '[subagent-done] agentId=w1 name=worker ok=true', timestamp: 6 },
    { id: 'u2', role: 'user', content: '第二问：加个测试', timestamp: 7 },
    { id: 'stalled', role: 'user', content: '[subagent-stalled] agentId=w1 idle=120s', timestamp: 8 }
  ]

  beforeEach(() => { vi.stubGlobal('IntersectionObserver', MockIntersectionObserver) })

  it('marks only real user prompts, scrolls on click, tooltips on hover, and tracks active', async () => {
    const host = createMockHost()
    vi.spyOn(host, 'getSessionHistory').mockResolvedValue(mixedHistory)
    render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    virtuosoHarness.scrollToIndex.mockClear()

    const rail = screen.getByTestId('prompt-rail')
    const ticks = rail.querySelectorAll('.prompt-rail-tick')
    // u1 + u2 only; heartbeat/done/stalled (user-role) and tool/assistant are excluded.
    expect(ticks).toHaveLength(2)
    const tick1 = within(rail).getByRole('button', { name: '用户输入 1/2' })
    const tick2 = within(rail).getByRole('button', { name: '用户输入 2/2' })

    // Live mode → latest user prompt is current.
    await waitFor(() => expect(tick2.getAttribute('data-active')).toBe('true'))

    // Hover summary (markdown-stripped, whitespace-collapsed, truncated).
    fireEvent.mouseEnter(tick2)
    expect(screen.getByTestId('prompt-rail-tooltip').textContent).toBe('第二问：加个测试')
    fireEvent.mouseLeave(tick2)

    // Click scrolls the existing transcript container to the message index and
    // keeps the sought prompt current (Swift "seeking" semantics).
    fireEvent.click(tick1)
    expect(virtuosoHarness.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', behavior: 'smooth' })
    await waitFor(() => expect(tick1.getAttribute('data-active')).toBe('true'))
  })

  it('hides the rail for a session with no user prompts', async () => {
    const host = createMockHost()
    vi.spyOn(host, 'getSessionHistory').mockResolvedValue([
      { id: 's1', role: 'assistant', content: 'nothing to do', timestamp: 1 },
      { id: 'hb', role: 'user', content: '[subagent-heartbeat] outstanding=0 vanished=0', timestamp: 2 }
    ])
    const { container } = render(<App host={host} />)
    await screen.findAllByText('Electron 三栏界面')
    expect(container.querySelector('.prompt-rail')).toBeNull()
    expect(screen.queryByTestId('prompt-rail')).toBeNull()
  })

  it('replaces the old dot style with thin tick CSS', () => {
    const appCss = readFileSync(join(__dirname, 'app.css'), 'utf8')
    // Old big-dot rail (circles on user messages) must be gone from app.css.
    expect(appCss).not.toContain('.prompt-rail button')
    expect(appCss).not.toContain('.prompt-rail{position:absolute')
    const railCss = readFileSync(join(__dirname, 'prompt-rail.css'), 'utf8')
    expect(railCss).toContain('.prompt-rail-tick::before')
    expect(railCss).toContain('width:14px') // rail column / active tick
    expect(railCss).toContain('min-width:14px')
    expect(railCss).toContain('padding:1px 0')
    expect(railCss).toContain('width:9px') // inactive tick
    expect(railCss).toContain('width:12px') // hover tick
    expect(railCss).toContain('height:var(--rail-pitch, 8px)')
    expect(railCss).toContain('max-height:min(70vh, calc(100dvh - 96px))')
    expect(railCss).not.toContain('max-height:240px')
    expect(railCss).toContain('border-radius:1.5px')
    expect(railCss).toContain('width:clamp(220px, 30vw, 320px)')
  })
})
