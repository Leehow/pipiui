// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    expect(copy.className).toBe(resend.className)
    expect(copy.querySelector('.message-action-icon')).toBeTruthy()
    expect(resend.querySelector('.message-action-icon')).toBeTruthy()
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

  it('uses one fixed-size control and icon treatment for every message action', () => {
    const css = readFileSync(join(import.meta.dirname, 'message-actions.css'), 'utf8')
    expect(css).toMatch(/\.message-action-button\{[^}]*width:32px;[^}]*height:32px;/)
    expect(css).toMatch(/\.message-action-icon\{[^}]*width:17px;[^}]*height:17px;/)
  })

  it('keeps the complete user message group on the trailing edge', () => {
    const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')
    expect(css).toContain('.user-message{display:flex;flex-direction:column;align-items:flex-end}')
    expect(css).toContain('.message-footer{display:flex;width:100%;')
    const actionCss = readFileSync(join(import.meta.dirname, 'message-actions.css'), 'utf8')
    expect(actionCss).toContain('.message-action-bar.trailing{justify-content:flex-end;margin-left:auto}')
  })
})
