// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageActionBar } from './MessageActionBar'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('MessageActionBar', () => {
  it('exposes an accessible copy toolbar and invokes its callback', () => {
    const onCopy = vi.fn()
    render(<MessageActionBar alignment="leading" canCopy onCopy={onCopy} />)
    expect(screen.getByRole('toolbar', { name: '消息操作' }).className).toContain('leading')
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }))
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('disables actions without calling callbacks', () => {
    const onCopy = vi.fn()
    const onResend = vi.fn()
    render(<MessageActionBar alignment="trailing" canCopy canResend copyDisabled resendDisabled onCopy={onCopy} onResend={onResend} />)
    expect(screen.getByRole('toolbar', { name: '消息操作' }).className).toContain('trailing')
    const copy = screen.getByRole('button', { name: '复制消息' }) as HTMLButtonElement
    const resend = screen.getByRole('button', { name: '重发消息' }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    expect(resend.disabled).toBe(true)
    fireEvent.click(copy)
    fireEvent.click(resend)
    expect(onCopy).not.toHaveBeenCalled()
    expect(onResend).not.toHaveBeenCalled()
  })

  it('shows a copied notice beside the actions', () => {
    render(<MessageActionBar alignment="leading" canCopy onCopy={() => undefined} copied />)
    expect(screen.getByRole('status').textContent).toBe('已复制')
  })
})
