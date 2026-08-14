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
    expect(screen.queryByText('Result:', { exact: true })).toBeNull()
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
