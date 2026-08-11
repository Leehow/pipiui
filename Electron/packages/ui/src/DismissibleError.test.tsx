// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DismissibleError } from './DismissibleError'

afterEach(cleanup)

describe('DismissibleError', () => {
  it('announces the message via role=alert and exposes an accessible close button', () => {
    render(<DismissibleError message="磁盘写入失败" onDismiss={() => undefined} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('磁盘写入失败')
    const close = screen.getByRole('button', { name: '关闭错误提示' })
    expect(close.textContent).toContain('×')
  })

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<DismissibleError message="操作失败" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders and wires the optional retry button only when onRetry is provided', () => {
    const onRetry = vi.fn()
    const view = render(<DismissibleError message="操作失败" onDismiss={() => undefined} onRetry={onRetry} />)
    const retry = screen.getByRole('button', { name: '重试' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
    view.rerender(<DismissibleError message="操作失败" onDismiss={() => undefined} />)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})
