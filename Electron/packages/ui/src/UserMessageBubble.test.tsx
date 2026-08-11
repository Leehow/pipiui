// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { messagePreview, shouldCollapseMessage, UserMessageBubble } from './UserMessageBubble'

afterEach(cleanup)

describe('UserMessageBubble', () => {
  it('uses Swift-compatible code point and line boundaries', () => {
    expect(shouldCollapseMessage('a'.repeat(1000))).toBe(false)
    expect(shouldCollapseMessage('a\nb\nc\nd\ne')).toBe(false)
    expect(shouldCollapseMessage('a'.repeat(1001))).toBe(true)
    expect(shouldCollapseMessage('a\nb\nc\nd\ne\nf')).toBe(true)
    expect(shouldCollapseMessage('')).toBe(false)
    expect(shouldCollapseMessage('😀'.repeat(1001))).toBe(true)
    expect(shouldCollapseMessage('中'.repeat(1001))).toBe(true)
  })

  it('builds a five-line, 400-code-point prefix without splitting surrogate pairs', () => {
    expect(messagePreview('1\n2\n3\n4\n5\n6')).toBe('1\n2\n3\n4\n5')
    expect(messagePreview('a'.repeat(401))).toBe('a'.repeat(400))
    const emojiPreview = messagePreview('😀'.repeat(401))
    expect([...emojiPreview]).toHaveLength(400)
    expect(emojiPreview.endsWith('😀')).toBe(true)
  })

  it('starts long messages collapsed and toggles their local disclosure state', () => {
    const text = `one\ntwo\nthree\nfour\nfive\nsix UNIQUE_FULL_TEXT_MARKER`
    const { container } = render(<UserMessageBubble text={text} />)
    const toggle = screen.getByRole('button', { name: '展开' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.user-message-content')?.textContent).toBe('one\ntwo\nthree\nfour\nfive')
    expect(screen.queryByText(/UNIQUE_FULL_TEXT_MARKER/)).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.user-message-content')?.textContent).toBe(text)

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.getByRole('button', { name: '展开' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/UNIQUE_FULL_TEXT_MARKER/)).toBeNull()
  })

  it('renders short messages directly without a disclosure control', () => {
    const { container } = render(<UserMessageBubble text={'短消息\n第二行'} />)
    expect(container.querySelector('.user-message-content')?.textContent).toBe('短消息\n第二行')
    expect(screen.queryByRole('button', { name: /展开|收起/ })).toBeNull()
  })
})
