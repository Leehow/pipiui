import { describe, expect, it, vi } from 'vitest'
import type { HostBackend, HostEvent } from '@pipi/host-api'
import { TerminalSessionHost, createPtyTerminalBackend, loadNativePtySpawn, resolveTerminalCwd, resolveTerminalShell } from './terminal-host.js'

function baseBackend(): HostBackend {
  return { handle: vi.fn(async () => undefined), subscribe: vi.fn(() => () => undefined) }
}

function ptyHarness() {
  let data: ((data: string) => void) | undefined
  let exit: ((event: { exitCode: number; signal?: number }) => void) | undefined
  const process = {
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn((listener: (chunk: string) => void) => { data = listener; return { dispose() {} } }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => { exit = listener; return { dispose() {} } })
  }
  const spawn = vi.fn(() => process)
  return { process, spawn, data: (chunk: string) => data?.(chunk), exit: (exitCode: number) => exit?.({ exitCode }) }
}

describe('PTY terminal host', () => {
  it('wraps native pty.node load failures and only invokes the loader once', () => {
    const load = vi.fn(() => { throw new Error('dlopen failed') })
    const spawn = loadNativePtySpawn(load)
    expect(() => spawn('/bin/zsh', ['-l'], {} as never)).toThrow(/pty\.node/)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('selects the platform default shell without hard-coding zsh cross-platform', () => {
    expect(resolveTerminalShell('darwin', { SHELL: '/opt/homebrew/bin/fish' })).toEqual({ file: '/opt/homebrew/bin/fish', args: ['-l'] })
    expect(resolveTerminalShell('linux', {})).toEqual({ file: '/bin/sh', args: ['-l'] })
    expect(resolveTerminalShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' })).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })
    expect(resolveTerminalShell('win32', { SystemRoot: 'D:\\Windows' }).file).toContain('WindowsPowerShell')
  })

  it('falls back from an invalid requested cwd', () => {
    expect(resolveTerminalCwd('/definitely/missing/pipiui-terminal', process.cwd())).toBe(process.cwd())
  })

  it('routes open, raw input, resize, output, exit and exact close to the PTY', async () => {
    const first = ptyHarness()
    const second = ptyHarness()
    const spawn = vi.fn()
      .mockImplementationOnce(first.spawn)
      .mockImplementationOnce(second.spawn)
    const controller = createPtyTerminalBackend(baseBackend(), { spawn, platform: 'linux', env: { SHELL: '/bin/bash' } })
    const events: HostEvent[] = []
    controller.backend.subscribe(event => events.push(event))

    const opened = await controller.backend.handle('terminalOpen', [{ sessionId: 'chat-a', cwd: process.cwd(), cols: 100, rows: 30 }]) as { id: string; cwd: string }
    const opened2 = await controller.backend.handle('terminalOpen', [{ sessionId: 'chat-a' }]) as { id: string }
    expect(spawn).toHaveBeenNthCalledWith(1, '/bin/bash', ['-l'], expect.objectContaining({ cwd: process.cwd(), cols: 100, rows: 30, name: 'xterm-256color', env: expect.objectContaining({ TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'en_US.UTF-8' }) }))

    await controller.backend.handle('terminalWrite', [opened.id, 'printf "raw"\r'])
    await controller.backend.handle('terminalResize', [opened.id, { cols: 132.9, rows: 41.8 }])
    expect(first.process.write).toHaveBeenCalledWith('printf "raw"\r')
    expect(first.process.resize).toHaveBeenCalledWith(132, 41)

    first.data('real output\r\n')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events.at(-1)).toMatchObject({ channel: 'terminal', event: { type: 'output', terminalId: opened.id, data: 'real output\r\n' } })
    first.exit(7)
    expect(events.at(-1)).toMatchObject({ channel: 'terminal', event: { type: 'exit', terminalId: opened.id, exitCode: 7 } })
    await expect(controller.backend.handle('terminalWrite', [opened.id, 'x'])).rejects.toThrow('terminal exited')

    await controller.backend.handle('terminalClose', [opened2.id])
    expect(second.process.kill).toHaveBeenCalledTimes(1)
    expect(first.process.kill).not.toHaveBeenCalled()
  })

  it('kills every remaining PTY during window/app cleanup', async () => {
    const one = ptyHarness()
    const two = ptyHarness()
    const spawn = vi.fn().mockImplementationOnce(one.spawn).mockImplementationOnce(two.spawn)
    const controller = createPtyTerminalBackend(baseBackend(), { spawn })
    await controller.backend.handle('terminalOpen', [{ sessionId: 'chat-a' }])
    await controller.backend.handle('terminalOpen', [{ sessionId: 'chat-b' }])
    controller.closeAll()
    expect(one.process.kill).toHaveBeenCalledTimes(1)
    expect(two.process.kill).toHaveBeenCalledTimes(1)
  })

  it('isolates sessions, requires exact terminal selection, and rejects stale snapshots', async () => {
    const one = ptyHarness(), two = ptyHarness(), three = ptyHarness()
    const host = new TerminalSessionHost({ spawn: vi.fn().mockImplementationOnce(one.spawn).mockImplementationOnce(two.spawn).mockImplementationOnce(three.spawn), platform: 'linux' })
    const a1 = await host.toolAction('chat-a', { action: 'open' })
    await host.toolAction('chat-a', { action: 'open' })
    const b1 = await host.toolAction('chat-b', { action: 'open' })
    expect(await host.toolAction('chat-a', { action: 'observe' })).toMatchObject({ ok: false, requiresSelection: true })
    await expect(host.toolAction('chat-a', { action: 'observe', terminal_id: b1.terminalId })).rejects.toThrow('unknown terminal')
    await host.toolAction('chat-a', { action: 'send', terminal_id: a1.terminalId, snapshot_id: a1.snapshotId, text: 'ls', enter: true })
    expect(one.process.write).toHaveBeenCalledWith('ls\r')
    await expect(host.toolAction('chat-a', { action: 'send', terminal_id: a1.terminalId, snapshot_id: a1.snapshotId, text: 'pwd' })).rejects.toThrow('stale')
  })

  it('tracks the current TUI framebuffer and blocks agents during private handoff', async () => {
    const harness = ptyHarness(); const host = new TerminalSessionHost({ spawn: harness.spawn, platform: 'linux' })
    const opened = await host.toolAction('chat', { action: 'open', cols: 20, rows: 3 })
    harness.data('first\r\nsecond\x1b[1A\roverwrite')
    await new Promise(resolve => setTimeout(resolve, 0))
    const observed = await host.toolAction('chat', { action: 'observe', terminal_id: opened.terminalId })
    expect(observed.screen).toContain('overwrite')
    await expect(host.toolAction('chat', { action: 'request_private_input', terminal_id: opened.terminalId })).rejects.toThrow('snapshot')
    await host.toolAction('chat', { action: 'request_private_input', terminal_id: opened.terminalId, snapshot_id: observed.snapshotId })
    await host.toolAction('chat', { action: 'begin_private_input', terminal_id: opened.terminalId })
    await expect(host.toolAction('chat', { action: 'observe', terminal_id: opened.terminalId })).rejects.toThrow('private input')
    const resumed = await host.toolAction('chat', { action: 'finish_private_input', terminal_id: opened.terminalId })
    expect(resumed.snapshotId).not.toBe(observed.snapshotId)
    expect(resumed).toMatchObject({ redacted: true, resyncRequired: true, screen: '' })
    harness.data('public again')
    await new Promise(resolve => setTimeout(resolve, 0))
    const fresh = await host.toolAction('chat', { action: 'observe', terminal_id: opened.terminalId })
    expect('resyncRequired' in fresh).toBe(false)
    expect(fresh.screen).toContain('public again')
  })

  it('attaches a delayed renderer to the exact current framebuffer and shares UI input back to agent observe', async () => {
    const first = ptyHarness(), second = ptyHarness()
    const host = new TerminalSessionHost({ spawn: vi.fn().mockImplementationOnce(first.spawn).mockImplementationOnce(second.spawn), platform: 'linux' })
    const backend = host.wrapBackend(baseBackend())
    const one = await host.toolAction('chat', { action: 'open', cols: 30, rows: 4 })
    const two = await host.toolAction('chat', { action: 'open', cols: 30, rows: 4 })
    first.data('agent ran before mount\r\nA$ '); second.data('distinct B screen\r\nB$ ')
    await new Promise(resolve => setTimeout(resolve, 0))
    const frameA = await backend.handle('terminalSnapshot', [one.terminalId]) as { initialOutput: string; revision: number }
    const frameB = await backend.handle('terminalSnapshot', [two.terminalId]) as { initialOutput: string }
    expect(frameA.initialOutput).toContain('agent ran before mount')
    expect(frameB.initialOutput).toContain('distinct B screen')
    expect(frameB.initialOutput).not.toContain('agent ran before mount')

    await backend.handle('terminalWrite', [one.terminalId, 'typed in visible xterm\r'])
    expect(first.process.write).toHaveBeenCalledWith('typed in visible xterm\r')
    first.data('typed in visible xterm\r\nshared result\r\nA$ ')
    await new Promise(resolve => setTimeout(resolve, 0))
    const observed = await host.toolAction('chat', { action: 'observe', terminal_id: one.terminalId })
    expect(observed.screen).toContain('shared result')
  })
})
