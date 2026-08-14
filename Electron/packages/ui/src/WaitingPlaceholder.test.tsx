// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatElapsed, waitingCopy, WaitingPlaceholder } from './WaitingPlaceholder'

afterEach(cleanup)

describe('waitingCopy', () => {
  it('rotates awaiting copy through fixed time slots (no randomness)', () => {
    // < 1.5s: connecting only
    expect(waitingCopy('awaiting', 0)).toBe('正在连接模型')
    expect(waitingCopy('awaiting', 1.49)).toBe('正在连接模型')
    // 1.5–8s: alternates reading-context / first-response in 3s slots
    expect(waitingCopy('awaiting', 1.5)).toBe('模型正在阅读上下文')
    expect(waitingCopy('awaiting', 4.49)).toBe('模型正在阅读上下文')
    expect(waitingCopy('awaiting', 4.5)).toBe('等待第一个响应')
    expect(waitingCopy('awaiting', 7.49)).toBe('等待第一个响应')
    // >= 8s: neutral long-wait copy, never implies stuck
    expect(waitingCopy('awaiting', 8)).toBe('模型仍在处理')
    expect(waitingCopy('awaiting', 300)).toBe('模型仍在处理')
  })

  it('is deterministic — the same elapsed always yields the same copy', () => {
    expect(waitingCopy('awaiting', 3.3)).toBe(waitingCopy('awaiting', 3.3))
    expect(waitingCopy('awaiting', 6.6)).toBe(waitingCopy('awaiting', 6.6))
  })

  it('clamps negative elapsed to the connecting bucket', () => {
    expect(waitingCopy('awaiting', -5)).toBe('正在连接模型')
  })

  it('returns static copy for non-awaiting phases regardless of elapsed', () => {
    expect(waitingCopy('thinking', 0)).toBe('模型正在思考…')
    expect(waitingCopy('thinking', 600)).toBe('模型正在思考…')
    expect(waitingCopy('tool', 8)).toBe('正在执行工具操作…')
    expect(waitingCopy('tool', 0)).toBe('正在执行工具操作…')
    expect(waitingCopy('retrying', 20)).toBe('连接中断，正在重试…')
    expect(waitingCopy('stopping', 45)).toBe('正在停止…')
    expect(waitingCopy('continuing', 0)).toBe('等待模型响应')
    expect(waitingCopy('continuing', 600)).toBe('等待模型响应')
    expect(waitingCopy('followup', 0)).toBe('正在处理子任务结果')
    expect(waitingCopy('followup', 94)).toBe('正在处理子任务结果')
  })
})

describe('formatElapsed', () => {
  it('formats boundary durations: 0, 1.5, 8, 60', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(1.5)).toBe('1s')
    expect(formatElapsed(8)).toBe('8s')
    expect(formatElapsed(60)).toBe('1min00s')
    expect(formatElapsed(61)).toBe('1min01s')
  })

  it('formats hours with padded minutes/seconds', () => {
    expect(formatElapsed(3600)).toBe('1h00min00s')
    expect(formatElapsed(3725)).toBe('1h02min05s')
  })

  it('clamps negative and fractional inputs', () => {
    expect(formatElapsed(-3)).toBe('0s')
    expect(formatElapsed(0.4)).toBe('0s')
  })
})

describe('WaitingPlaceholder', () => {
  it('renders an inline status row with role=status, aria-live=polite and the 3-bar waveform', () => {
    const { container } = render(<WaitingPlaceholder phase="awaiting" startedAt={Date.now()} />)
    const row = screen.getByTestId('waiting-placeholder')
    expect(row.getAttribute('role')).toBe('status')
    expect(row.getAttribute('aria-live')).toBe('polite')
    expect(row.getAttribute('data-phase')).toBe('awaiting')
    expect(row.textContent).toContain('正在连接模型')
    // < 1.5s: no elapsed readout, no stop control (onStop not provided)
    expect(screen.queryByTestId('waiting-elapsed')).toBeNull()
    expect(screen.queryByTestId('waiting-stop')).toBeNull()
    // 3 bars, hidden from the a11y tree
    expect(container.querySelectorAll('.waiting-placeholder__bar').length).toBe(3)
    expect(container.querySelector('.waiting-placeholder__bars')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows elapsed after 1.5s and switches to the long-wait copy at 8s', () => {
    vi.useFakeTimers({ now: Date.now() })
    try {
      const started = Date.now()
      const view = render(<WaitingPlaceholder phase="awaiting" startedAt={new Date(started)} />)
      expect(screen.queryByTestId('waiting-elapsed')).toBeNull()

      act(() => { vi.advanceTimersByTime(1_500) })
      expect(screen.getByTestId('waiting-elapsed').textContent).toContain('已用时 1s')
      expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型正在阅读上下文')

      act(() => { vi.advanceTimersByTime(7_000) })
      expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型仍在处理')
      expect(screen.getByTestId('waiting-elapsed').textContent).toContain('已用时 8s')

      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows detail and keeps the phase copy for tool phase', () => {
    render(<WaitingPlaceholder phase="tool" startedAt={Date.now()} detail="Bash" />)
    const row = screen.getByTestId('waiting-placeholder')
    expect(row.textContent).toContain('正在执行工具操作…')
    expect(row.textContent).toContain('Bash')
  })

  it('renders a keyboard-operable stop button only when onStop is provided', () => {
    const onStop = vi.fn()
    const view = render(<WaitingPlaceholder phase="thinking" startedAt={Date.now()} onStop={onStop} />)
    const stop = screen.getByTestId('waiting-stop')
    expect(stop.tagName).toBe('BUTTON')
    expect(stop.getAttribute('type')).toBe('button')
    expect(stop.getAttribute('aria-label')).toBe('停止生成')
    stop.focus()
    expect(document.activeElement).toBe(stop)
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledTimes(1)

    view.rerender(<WaitingPlaceholder phase="thinking" startedAt={Date.now()} />)
    expect(screen.queryByTestId('waiting-stop')).toBeNull()
  })

  it('applies the is-reduce-motion class when reduceMotion is set', () => {
    const { container } = render(<WaitingPlaceholder phase="awaiting" startedAt={Date.now()} reduceMotion />)
    expect(container.querySelector('.waiting-placeholder')!.classList.contains('is-reduce-motion')).toBe(true)
  })

  it('keeps a single tick interval mounted and clears it on unmount', () => {
    vi.useFakeTimers({ now: Date.now() })
    try {
      const view = render(<WaitingPlaceholder phase="awaiting" startedAt={Date.now()} />)
      expect(vi.getTimerCount()).toBe(1)
      view.unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets the readout when startedAt changes to a new turn', () => {
    vi.useFakeTimers({ now: Date.now() })
    try {
      const t0 = Date.now()
      const view = render(<WaitingPlaceholder phase="awaiting" startedAt={t0} />)
      act(() => { vi.advanceTimersByTime(4_000) })
      expect(screen.getByTestId('waiting-placeholder').textContent).toContain('模型正在阅读上下文')
      expect(screen.getByTestId('waiting-elapsed').textContent).toContain('已用时 4s')

      // New turn starts 6s after the old one: elapsed must reset, not accumulate.
      view.rerender(<WaitingPlaceholder phase="awaiting" startedAt={t0 + 6_000} />)
      expect(screen.queryByTestId('waiting-elapsed')).toBeNull()
      expect(screen.getByTestId('waiting-placeholder').textContent).toContain('正在连接模型')

      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
