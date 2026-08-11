// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PipiHostAPI, TerminalEvent } from '@pipi/host-api'

const xtermHarness = vi.hoisted(() => ({ instances: [] as any[] }))

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    options: any
    cols = 80
    rows = 24
    buffer = { active: { viewportY: 0, baseY: 0 } }
    open = vi.fn()
    write = vi.fn()
    clear = vi.fn()
    reset = vi.fn()
    focus = vi.fn()
    scrollToBottom = vi.fn()
    dispose = vi.fn()
    loadAddon = vi.fn()
    private dataListener?: (data: string) => void
    private scrollListener?: () => void

    constructor(options: any) {
      this.options = options
      xtermHarness.instances.push(this)
    }

    onData(listener: (data: string) => void) {
      this.dataListener = listener
      return { dispose: vi.fn() }
    }

    onScroll(listener: () => void) {
      this.scrollListener = listener
      return { dispose: vi.fn() }
    }

    emitData(data: string) { this.dataListener?.(data) }
    emitScroll() { this.scrollListener?.() }
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn() } }))

afterEach(() => {
  cleanup()
  xtermHarness.instances.length = 0
})

async function renderTerminalPanel(host: PipiHostAPI, theme: 'light' | 'dark', projectId?: string, projectPath?: string) {
  const { TerminalPanel } = await import('./TerminalPanel')
  return render(<TerminalPanel host={host} theme={theme} projectId={projectId} projectPath={projectPath} />)
}

function terminalHost() {
  const listeners = new Map<string, Set<(event: TerminalEvent) => void>>()
  const frames = new Map<string, { output: string; revision: number }>()
  let nextId = 0
  const open = vi.fn(async (options?: { sessionId?: string }) => {
    nextId += 1
    const id = `terminal-${nextId}`
    const initialOutput = '\u001b[1;36mmock terminal\u001b[0m\r\n$ '
    frames.set(id, { output: initialOutput, revision: 1 })
    return { id, title: '终端', cwd: '/tmp/pipiui', sessionId: options?.sessionId, initialOutput }
  })
  const write = vi.fn(async () => undefined)
  const resize = vi.fn(async () => undefined)
  const clear = vi.fn(async () => undefined)
  const close = vi.fn(async () => undefined)
  const privateInput = vi.fn(async () => ({ ok: true }))
  const snapshot = vi.fn(async (terminalId: string) => ({ terminalId, initialOutput: frames.get(terminalId)?.output ?? '', revision: frames.get(terminalId)?.revision ?? 1, cols: 80, rows: 24 }))
  const subscribe = vi.fn((terminalId: string, next: (event: TerminalEvent) => void) => {
    const subscribers = listeners.get(terminalId) ?? new Set<(event: TerminalEvent) => void>()
    subscribers.add(next)
    listeners.set(terminalId, subscribers)
    return () => subscribers.delete(next)
  })
  const host = { protocolVersion: 2, terminal: { open, write, resize, clear, close, privateInput, snapshot, subscribe } } as unknown as PipiHostAPI
  return { host, open, write, resize, clear, close, privateInput, snapshot, subscribe, emit: (event: TerminalEvent) => {
    if (!('terminalId' in event)) return
    if (event.type === 'output') { const frame = frames.get(event.terminalId) ?? { output: '', revision: 1 }; frame.output += event.data; frame.revision = event.revision ?? frame.revision + 1; frames.set(event.terminalId, frame) }
    listeners.get(event.terminalId)?.forEach(listener => listener(event))
  } }
}

describe('TerminalPanel', () => {
  it('hydrates delayed mount from the exact framebuffer and replays only later output', async () => {
    const harness = terminalHost()
    let resolveFrame!: (value: { terminalId: string; initialOutput: string; revision: number; cols: number; rows: number }) => void
    harness.snapshot.mockImplementationOnce(() => new Promise(resolve => { resolveFrame = resolve }))
    await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(harness.subscribe).toHaveBeenCalledWith('terminal-1', expect.any(Function)))
    const terminal = xtermHarness.instances[0]
    harness.emit({ type: 'output', terminalId: 'terminal-1', data: 'after snapshot\r\n', revision: 3 })
    expect(terminal.write).not.toHaveBeenCalledWith('after snapshot\r\n')
    resolveFrame({ terminalId: 'terminal-1', initialOutput: 'agent output before UI mount\r\n$ ', revision: 2, cols: 80, rows: 24 })
    await waitFor(() => expect(terminal.reset).toHaveBeenCalledTimes(1))
    expect(terminal.write).toHaveBeenCalledWith('agent output before UI mount\r\n$ ')
    expect(terminal.write).toHaveBeenCalledWith('after snapshot\r\n')
  })
  it('offers explicit user controls while a terminal is in private handoff', async () => {
    const harness = terminalHost(); await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(harness.subscribe).toHaveBeenCalled())
    harness.emit({ type: 'private', terminalId: 'terminal-1', state: 'pending' })
    fireEvent.click(await screen.findByRole('button', { name: '开始私密输入' }))
    expect(harness.privateInput).toHaveBeenCalledWith('terminal-1', 'begin_private_input')
    harness.emit({ type: 'private', terminalId: 'terminal-1', state: 'active' })
    fireEvent.click(await screen.findByRole('button', { name: '完成私密输入并交还 Agent' }))
    expect(harness.privateInput).toHaveBeenCalledWith('terminal-1', 'finish_private_input')
  })
  it('renders an xterm surface with token-based theme and streamed output', async () => {
    const harness = terminalHost()
    await renderTerminalPanel(harness.host, 'light', 'pipiui', '/tmp/pipiui')

    await waitFor(() => expect(harness.open).toHaveBeenCalledWith({ sessionId: '', projectId: 'pipiui', cwd: '/tmp/pipiui' }))
    const terminal = xtermHarness.instances[0]
    expect(screen.getByTestId('terminal-panel')).toBeTruthy()
    expect(terminal.open).toHaveBeenCalled()
    expect(terminal.options.scrollback).toBe(10_000)
    expect(terminal.options.theme.background).toBe('#f5f5f7')
    expect(terminal.write).toHaveBeenCalledWith(expect.stringContaining('mock terminal'))
    await waitFor(() => expect(harness.subscribe).toHaveBeenCalledWith('terminal-1', expect.any(Function)))

    harness.emit({ type: 'output', terminalId: 'terminal-1', data: 'streamed output\r\n' })
    await waitFor(() => expect(terminal.write).toHaveBeenCalledWith('streamed output\r\n'))
  })

  it('keeps terminal scrollback user-controlled and returns to the latest output', async () => {
    const harness = terminalHost()
    await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    const terminal = xtermHarness.instances[0]

    terminal.buffer.active.viewportY = 2
    terminal.buffer.active.baseY = 8
    terminal.emitScroll()
    fireEvent.click(await screen.findByRole('button', { name: '回到终端底部' }))
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('forwards raw input and dimensions through the host, and clears only xterm locally', async () => {
    const harness = terminalHost()
    await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    const terminal = xtermHarness.instances[0]

    terminal.emitData('echo pasted command\r')
    await waitFor(() => expect(harness.write).toHaveBeenCalledWith('terminal-1', 'echo pasted command\r'))
    const surface = screen.getByTestId('xterm-surface-terminal-1')
    Object.defineProperty(surface, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(surface, 'clientHeight', { configurable: true, value: 400 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => expect(harness.resize).toHaveBeenCalledWith('terminal-1', { cols: 80, rows: 24 }))
    fireEvent.click(screen.getByRole('button', { name: '清屏' }))
    expect(terminal.clear).toHaveBeenCalledTimes(1)
    expect(harness.clear).not.toHaveBeenCalled()
  })

  it('keeps each tab output while adding, switching, and closing terminal tabs', async () => {
    const harness = terminalHost()
    await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    const first = xtermHarness.instances[0]
    await waitFor(() => expect(harness.subscribe).toHaveBeenCalledWith('terminal-1', expect.any(Function)))
    harness.emit({ type: 'output', terminalId: 'terminal-1', data: 'first tab output\r\n' })
    await waitFor(() => expect(first.write).toHaveBeenCalledWith('first tab output\r\n'))

    fireEvent.click(screen.getByRole('button', { name: '新建终端' }))
    await waitFor(() => expect(harness.open).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(2))
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('xterm-surface-terminal-1')).toBeNull()
    expect(screen.getByTestId('xterm-surface-terminal-2')).toBeTruthy()
    const second = xtermHarness.instances[1]
    await waitFor(() => expect(harness.subscribe).toHaveBeenCalledWith('terminal-2', expect.any(Function)))
    harness.emit({ type: 'output', terminalId: 'terminal-2', data: 'second tab output\r\n' })
    await waitFor(() => expect(second.write).toHaveBeenCalledWith('second tab output\r\n'))

    fireEvent.click(screen.getByRole('tab', { name: '终端 1' }))
    expect(screen.getByRole('tab', { name: '终端 1' }).getAttribute('aria-selected')).toBe('true')
    await screen.findByTestId('xterm-surface-terminal-1')
    expect(screen.queryByTestId('xterm-surface-terminal-2')).toBeNull()
    const remountedFirst = xtermHarness.instances.at(-1)
    await waitFor(() => expect(remountedFirst.reset).toHaveBeenCalledTimes(1))
    expect(remountedFirst.write).toHaveBeenCalledWith(expect.stringContaining('first tab output'))
    fireEvent.click(screen.getByRole('tab', { name: '终端 2' }))
    expect(screen.getByRole('tab', { name: '终端 2' }).getAttribute('aria-selected')).toBe('true')
    await screen.findByTestId('xterm-surface-terminal-2')
    expect(screen.queryByTestId('xterm-surface-terminal-1')).toBeNull()
    const remountedSecond = xtermHarness.instances.at(-1)
    await waitFor(() => expect(remountedSecond.reset).toHaveBeenCalledTimes(1))
    expect(remountedSecond.write).toHaveBeenCalledWith(expect.stringContaining('second tab output'))

    fireEvent.click(screen.getByLabelText('关闭 终端 2'))
    await waitFor(() => expect(harness.close).toHaveBeenCalledWith('terminal-2'))
    await waitFor(() => expect(remountedSecond.dispose).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('tab', { name: '终端' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('xterm-surface-terminal-1')).toBeTruthy()
    expect(screen.queryByTestId('xterm-surface-terminal-2')).toBeNull()
  })

  it('shows only the active surface and preserves independent terminal sets while switching chat sessions', async () => {
    const harness = terminalHost(); const { TerminalPanel } = await import('./TerminalPanel')
    const view = render(<TerminalPanel host={harness.host} theme="dark" sessionId="chat-a" projectPath="/tmp/a" />)
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '新建终端' }))
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(2))
    expect(screen.getByRole('tab', { name: '终端 2' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('xterm-surface-terminal-1')).toBeNull()
    expect(screen.getByTestId('xterm-surface-terminal-2')).toBeTruthy()
    harness.emit({ type: 'output', terminalId: 'terminal-2', data: 'chat a second tab\r\n' })

    view.rerender(<TerminalPanel host={harness.host} theme="dark" sessionId="chat-b" projectPath="/tmp/b" />)
    await screen.findByTestId('xterm-surface-terminal-3')
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.queryByTestId('xterm-surface-terminal-1')).toBeNull()
    expect(screen.queryByTestId('xterm-surface-terminal-2')).toBeNull()
    expect(screen.getByTestId('xterm-surface-terminal-3')).toBeTruthy()
    expect(harness.open).toHaveBeenLastCalledWith({ sessionId: 'chat-b', projectId: undefined, cwd: '/tmp/b' })

    view.rerender(<TerminalPanel host={harness.host} theme="dark" sessionId="chat-a" projectPath="/tmp/a" />)
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2))
    expect(screen.getByRole('tab', { name: '终端 2' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('xterm-surface-terminal-2')).toBeTruthy()
    expect(screen.queryByTestId('xterm-surface-terminal-1')).toBeNull()
    expect(screen.queryByTestId('xterm-surface-terminal-3')).toBeNull()
    const restoredSecond = xtermHarness.instances.at(-1)
    await waitFor(() => expect(restoredSecond.write).toHaveBeenCalledWith(expect.stringContaining('chat a second tab')))
  })

  it('clears only the currently active terminal tab', async () => {
    const harness = terminalHost()
    await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    const first = xtermHarness.instances[0]
    fireEvent.click(screen.getByRole('button', { name: '新建终端' }))
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(2))
    const second = xtermHarness.instances[1]

    fireEvent.click(screen.getByRole('button', { name: '清屏' }))
    expect(second.clear).toHaveBeenCalledTimes(1)
    expect(first.clear).not.toHaveBeenCalled()
    expect(harness.clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: '终端 1' }))
    await screen.findByTestId('xterm-surface-terminal-1')
    const remountedFirst = xtermHarness.instances.at(-1)
    fireEvent.click(screen.getByRole('button', { name: '清屏' }))
    expect(remountedFirst.clear).toHaveBeenCalledTimes(1)
    expect(first.clear).not.toHaveBeenCalled()
    expect(second.clear).toHaveBeenCalledTimes(1)
    expect(harness.clear).not.toHaveBeenCalled()
  })

  it('shows a dismissible error when the initial open fails and re-shows it on a failing retry', async () => {
    const harness = terminalHost()
    harness.open.mockRejectedValue(new Error('mock open failure'))
    await renderTerminalPanel(harness.host, 'dark')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mock open failure')
    expect(screen.getByRole('button', { name: '关闭错误提示' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()

    // a failing retry re-shows the same error
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('mock open failure')
    expect(harness.open).toHaveBeenCalledTimes(2)

    // dismissing clears the error and restores the connecting empty state
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByText('正在连接终端…')).toBeTruthy()
  })

  it('recovers when a retry of the failed initial open succeeds', async () => {
    const harness = terminalHost()
    harness.open.mockRejectedValueOnce(new Error('mock open failure'))
    await renderTerminalPanel(harness.host, 'dark')

    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(harness.open).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('tab', { name: '终端' })).toBeTruthy()
  })

  it('dismisses a floating session error and re-shows it when the failure re-occurs', async () => {
    const harness = terminalHost()
    await renderTerminalPanel(harness.host, 'dark')
    await waitFor(() => expect(xtermHarness.instances).toHaveLength(1))
    const terminal = xtermHarness.instances[0]
    harness.write.mockRejectedValue(new Error('mock write failure'))

    terminal.emitData('echo broken\r')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mock write failure')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())

    terminal.emitData('echo broken\r')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('mock write failure')
  })
})
