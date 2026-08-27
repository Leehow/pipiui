// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageView } from './Transcript'
import type { ChatMessage } from './transcript-model'

vi.mock('@xterm/xterm', () => ({ Terminal: class { buffer = { active: { viewportY: 0, baseY: 0 } }; options = {}; open = vi.fn(); write = vi.fn(); clear = vi.fn(); focus = vi.fn(); scrollToBottom = vi.fn(); loadAddon = vi.fn(); dispose = vi.fn(); onData() { return { dispose: vi.fn() } } onScroll() { return { dispose: vi.fn() } } } }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(cleanup)

const handlers = { onCopy: vi.fn(() => Promise.resolve()), onResend: vi.fn(), resendDisabled: false, copied: false }

describe('SubagentSignalCard MessageView integration', () => {
  it('renders a heartbeat as an animated running indicator instead of a static glyph', () => {
    const message: ChatMessage = { id: 'heartbeat', role: 'user', content: '[subagent-heartbeat] outstanding=1 vanished=0 stalled=0\n  a1 (测试) — running 2m, idle 4s, state=running', timestamp: 1 }
    const { container } = render(<MessageView message={message} {...handlers} />)
    const disclosure = screen.getByRole('button', { name: /运行中/ })
    expect(container.querySelector('[data-activity-status="running"]')).toBeTruthy()
    expect(disclosure.querySelector('.activity-spinner')).toBeTruthy()
    expect(disclosure.querySelector('.activity-status')?.textContent).not.toBe('◌')
  })

  it('renders one compact collapsed done card without human bubble, prompt marker or resend action', () => {
    const message: ChatMessage = { id: 'done', role: 'user', content: '[subagent-done] agentId=a1 name=general-purpose ok=true verified=fail cost=0.1659 turns=9\nTitle: 修复列表\nResult:\n完成 report.md', timestamp: 1 }
    const { container } = render(<MessageView message={message} showFooter documentBasePath="/tmp/project" {...handlers} />)
    expect(container.querySelectorAll('[data-testid="subagent-signal-card"]')).toHaveLength(1)
    expect(container.querySelector('.user-bubble')).toBeNull()
    expect(container.querySelector('[data-user-prompt]')).toBeNull()
    expect(screen.queryByRole('button', { name: '重发消息' })).toBeNull()
    const disclosure = screen.getByRole('button', { name: /已完成 · 修复列表.*验证失败/ })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.subagent-signal-warning')).toBeTruthy()
    expect(container.querySelector('[data-activity-status="warning"]')).toBeTruthy()
    expect(container.querySelector('.activity-card-result')).toBeNull()
    expect(disclosure.querySelector('.activity-status')?.textContent).toBe('!')
    expect(disclosure.querySelector('.activity-status')?.textContent).not.toBe('✓')
    expect(screen.queryByText('Result:', { exact: true })).toBeNull()
  })

  it('renders ok=false as an error card with × and 失败, not a green check', () => {
    const message: ChatMessage = { id: 'failed', role: 'user', content: '[subagent-done] name=worker ok=false verified=none\nTitle: 超时\nResult:\nruntime_timeout: no progress', timestamp: 1 }
    const { container } = render(<MessageView message={message} {...handlers} />)
    const disclosure = screen.getByRole('button', { name: /失败 · 超时/ })
    expect(container.querySelector('.subagent-signal-error')).toBeTruthy()
    expect(container.querySelector('[data-activity-status="error"]')).toBeTruthy()
    expect(container.querySelector('.activity-card-error')).toBeTruthy()
    expect(container.querySelector('.activity-card-result')).toBeNull()
    expect(disclosure.querySelector('.activity-status')?.textContent).toBe('×')
    expect(disclosure.textContent).toContain('失败')
    expect(disclosure.textContent).not.toMatch(/已完成/)
  })

  it('renders ok=true verified=pass as a green success card', () => {
    const message: ChatMessage = { id: 'ok', role: 'user', content: '[subagent-done] name=worker ok=true verified=pass\nTitle: 文档\nResult:\nok', timestamp: 1 }
    const { container } = render(<MessageView message={message} {...handlers} />)
    const disclosure = screen.getByRole('button', { name: /已完成 · 文档.*验证通过/ })
    expect(container.querySelector('.subagent-signal-success')).toBeTruthy()
    expect(container.querySelector('[data-activity-status="ok"]')).toBeTruthy()
    expect(container.querySelector('.activity-card-result')).toBeTruthy()
    expect(disclosure.querySelector('.activity-status')?.textContent).toBe('✓')
  })

  it('expands detail and keeps document reference cards clickable', () => {
    const open = vi.fn()
    const message: ChatMessage = { id: 'done', role: 'user', content: '[subagent-done] name=worker ok=true verified=pass\nTitle: 文档\nVerify: npm test (exit 0)\nResult:\nSee docs/report.md' }
    render(<MessageView message={message} documentBasePath="/tmp/project" onOpenDocument={open} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /已完成 · 文档/ }))
    expect(screen.getByText(/Verify: npm test \(exit 0\)/)).toBeTruthy()
    expect(screen.getByText(/See docs\/report\.md/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '打开文档 report.md' }))
    expect(open).toHaveBeenCalledWith('/tmp/project/docs/report.md')
  })

  it('keeps ordinary user messages and resend actions unchanged', () => {
    const message: ChatMessage = { id: 'human', role: 'user', content: '普通用户消息' }
    const { container } = render(<MessageView message={message} showFooter {...handlers} />)
    expect(container.querySelector('.user-bubble')).toBeTruthy()
    expect(container.querySelector('[data-user-prompt="human"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重发消息' })).toBeTruthy()
  })
})

const WATCH_MATCHED = '[browser-watch] watchId=bw-17 reason=matched waitedMs=4200 url=https://example.com/ready title=Example Ready\n页面出现 .ready 元素\nUse browser observe to inspect the current page. Do not treat this message as a new user request.'

describe('BrowserWatchCard MessageView integration', () => {
  it('renders a watch wake as one compact internal card without human bubble, prompt marker or resend', () => {
    const message: ChatMessage = { id: 'watch', role: 'user', content: WATCH_MATCHED, timestamp: 1 }
    const { container } = render(<MessageView message={message} showFooter documentBasePath="/tmp/project" {...handlers} />)
    expect(container.querySelectorAll('[data-testid="subagent-signal-card"]')).toHaveLength(1)
    const card = container.querySelector('[data-signal-kind="browser-watch"]')!
    expect(card).toBeTruthy()
    expect(card.className).toContain('subagent-signal-success')
    expect(container.querySelector('.user-bubble')).toBeNull()
    expect(container.querySelector('[data-user-prompt]')).toBeNull()
    expect(screen.queryByRole('button', { name: '重发消息' })).toBeNull()
    const disclosure = screen.getByRole('button', { name: /浏览器监听.*条件命中 · Example Ready/ })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    // Collapsed: the raw protocol trailer must not leak as visible prose.
    expect(screen.queryByText(/Do not treat this message as a new user request/)).toBeNull()
  })

  it('expands to the page summary and trailer on demand', () => {
    const message: ChatMessage = { id: 'watch', role: 'user', content: WATCH_MATCHED }
    render(<MessageView message={message} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /条件命中 · Example Ready/ }))
    expect(screen.getByText(/页面出现 \.ready 元素/)).toBeTruthy()
    expect(screen.getByText(/Do not treat this message as a new user request/)).toBeTruthy()
  })

  it('renders wrapped re-delivery and timeout wakes as internal cards, never bubbles', () => {
    const wrapped: ChatMessage = { id: 'watch-retry', role: 'user', content: `(re-delivery #2: Pi did not confirm the prior follow-up; obligationId=o1; treat it as the same event.)\n[browser-watch] watchId=bw-8 reason=timeout waitedMs=65000 url=https://example.com/pending\nUse browser observe to inspect the current page. Do not treat this message as a new user request.` }
    const { container } = render(<MessageView message={wrapped} showFooter {...handlers} />)
    expect(container.querySelector('[data-signal-kind="browser-watch"]')).toBeTruthy()
    expect(container.querySelector('.subagent-signal-warning')).toBeTruthy()
    expect(container.querySelector('.user-bubble')).toBeNull()
    expect(container.querySelector('[data-user-prompt]')).toBeNull()
  })

  it('renders a structurally valid unknown reason as a neutral internal card', () => {
    const message: ChatMessage = { id: 'watch-future', role: 'user', content: '[browser-watch] watchId=bw-9 reason=expired waitedMs=10' }
    const { container } = render(<MessageView message={message} showFooter {...handlers} />)
    const card = container.querySelector('[data-signal-kind="browser-watch"]')!
    expect(card).toBeTruthy()
    expect(card.className).toContain('subagent-signal-neutral')
    expect(container.querySelector('.user-bubble')).toBeNull()
    expect(container.querySelector('[data-user-prompt]')).toBeNull()
  })

  it('keeps malformed and non-canonical watch text as ordinary human bubbles', () => {
    const cases = [
      '[browser-watch] 普通文本乱写',
      '[browser-watch] watchId=bw-1 reason=matched',
      '[browser-watch] watchId=bw-1 reason=matched waitedMs=abc',
      '[browser-watch] watchId=a watchId=b reason=matched waitedMs=1',
    ]
    for (const content of cases) {
      const message: ChatMessage = { id: 'watch-odd', role: 'user', content }
      const { container } = render(<MessageView message={message} showFooter {...handlers} />)
      expect(container.querySelector('[data-signal-kind="browser-watch"]')).toBeNull()
      expect(container.querySelector('.user-bubble')).toBeTruthy()
      expect(container.querySelector('[data-user-prompt="watch-odd"]')).toBeTruthy()
      cleanup()
    }
  })
})
