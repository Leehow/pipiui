import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as nodePty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { HostBackend, HostEvent, TerminalToolRequest, TerminalToolResult } from '@pipi/host-api'
import { PIPI_HOST_PROTOCOL_VERSION } from '@pipi/host-api'

type PtyProcess = Pick<nodePty.IPty, 'write' | 'resize' | 'kill' | 'onData' | 'onExit'>
type PtySpawn = (file: string, args: string[], options: nodePty.IPtyForkOptions) => PtyProcess
type PrivateState = 'none' | 'pending' | 'active'
type RecordEntry = {
  id: string; sessionId: string; title: string; cwd: string; cols: number; rows: number
  pty: PtyProcess; screen: Terminal; serializer: SerializeAddon; revision: number; closed: boolean; exitCode?: number
  privateState: PrivateState; resyncRequired: boolean; queue: Promise<unknown>; changed: Set<() => void>
}

export function resolveTerminalShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { file: string; args: string[] } {
  if (platform === 'win32') return { file: env.COMSPEC || (env.SystemRoot ? join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe'), args: [] }
  return { file: env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh'), args: ['-l'] }
}

function usableDirectory(path: string | undefined): path is string {
  if (!path || !existsSync(path)) return false
  try { return statSync(path).isDirectory() } catch { return false }
}

export function resolveTerminalCwd(requested: string | undefined, processCwd = process.cwd(), home = homedir()): string {
  if (usableDirectory(requested)) return requested
  if (usableDirectory(processCwd)) return processCwd
  if (usableDirectory(home)) return home
  return process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/'
}

const KEY_DATA: Record<string, string> = {
  ENTER: '\r', TAB: '\t', ESCAPE: '\x1b', BACKSPACE: '\x7f', DELETE: '\x1b[3~',
  UP: '\x1b[A', DOWN: '\x1b[B', RIGHT: '\x1b[C', LEFT: '\x1b[D', HOME: '\x1b[H', END: '\x1b[F',
  PAGE_UP: '\x1b[5~', PAGE_DOWN: '\x1b[6~', CTRL_C: '\x03', CTRL_D: '\x04', CTRL_Z: '\x1a'
}

export class TerminalSessionHost {
  private listeners = new Set<(event: HostEvent) => void>()
  private spaces = new Map<string, Map<string, RecordEntry>>()
  private active = new Map<string, string>()
  private spawn: PtySpawn
  private platform: NodeJS.Platform
  private env: NodeJS.ProcessEnv

  constructor(options: { spawn?: PtySpawn; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}) {
    this.spawn = options.spawn ?? nodePty.spawn
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
  }

  subscribe(listener: (event: HostEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(event: HostEvent) { for (const listener of this.listeners) listener(event) }
  private space(sessionId: string) { let value = this.spaces.get(sessionId); if (!value) this.spaces.set(sessionId, value = new Map()); return value }
  private get(sessionId: string, id: string) { const value = this.spaces.get(sessionId)?.get(id); if (!value) throw new Error(`unknown terminal: ${id}`); return value }
  private locateForRenderer(id: string) { for (const space of this.spaces.values()) { const value = space.get(id); if (value) return value } throw new Error(`unknown terminal: ${id}`) }
  private notify(entry: RecordEntry) { entry.revision++; for (const wake of [...entry.changed]) wake() }
  private snapshotId(entry: RecordEntry) { return `${entry.id}:${entry.revision}` }
  private summary(entry: RecordEntry) { return { terminalId: entry.id, title: entry.title, cwd: entry.cwd, cols: entry.cols, rows: entry.rows, exited: entry.closed, exitCode: entry.exitCode, privateState: entry.privateState } }
  private observation(entry: RecordEntry): TerminalToolResult {
    if (entry.resyncRequired) return { ok: true, ...this.summary(entry), snapshotId: this.snapshotId(entry), screen: '', screenRows: [], redacted: true, resyncRequired: true, truncated: false }
    const buffer = entry.screen.buffer.active
    const rows: string[] = []
    for (let y = 0; y < entry.rows; y++) rows.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '')
    return { ok: true, ...this.summary(entry), snapshotId: this.snapshotId(entry), screen: rows.join('\n'), screenRows: rows, cursor: { x: buffer.cursorX, y: buffer.cursorY }, truncated: buffer.baseY > 0 }
  }
  private reveal(entry: RecordEntry) { this.active.set(entry.sessionId, entry.id); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'reveal', sessionId: entry.sessionId, terminalId: entry.id } }) }
  private ensurePublic(entry: RecordEntry) { if (entry.privateState !== 'none') throw new Error('terminal private input is active; user must finish or cancel handoff') }
  private ensureMutable(entry: RecordEntry, snapshotId: unknown) { this.ensurePublic(entry); if (entry.closed) throw new Error(`terminal exited with code ${entry.exitCode ?? '?'}`); if (snapshotId !== this.snapshotId(entry)) throw new Error('stale or missing terminal snapshot_id; observe again') }
  private serial<T>(entry: RecordEntry, action: () => Promise<T> | T): Promise<T> { const result = entry.queue.then(action, action); entry.queue = result.catch(() => undefined); return result }

  open(sessionId: string, options: { cwd?: string; cols?: number; rows?: number } = {}) {
    if (!sessionId) throw new Error('terminal sessionId is required')
    const id = `terminal-${randomUUID()}`; const cwd = resolveTerminalCwd(options.cwd); const shell = resolveTerminalShell(this.platform, this.env)
    const cols = Math.max(2, Math.floor(options.cols || 80)); const rows = Math.max(1, Math.floor(options.rows || 24))
    const pty = this.spawn(shell.file, shell.args, { name: 'xterm-256color', cwd, cols, rows, env: { ...this.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: this.env.LANG || 'en_US.UTF-8' } as Record<string, string> })
    const screen = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true }); const serializer = new SerializeAddon(); screen.loadAddon(serializer)
    const entry: RecordEntry = { id, sessionId, title: shell.file.split(/[\\/]/).pop() || '终端', cwd, cols, rows, pty, screen, serializer, revision: 1, closed: false, privateState: 'none', resyncRequired: false, queue: Promise.resolve(), changed: new Set() }
    this.space(sessionId).set(id, entry); this.active.set(sessionId, id)
    this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'opened', sessionId, terminal: { id, title: entry.title, cwd, sessionId, snapshotId: this.snapshotId(entry), privateState: entry.privateState } } })
    pty.onData(data => {
      if (entry.privateState === 'active') { this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'output', terminalId: id, data } }); return }
      entry.resyncRequired = false
      entry.screen.write(data, () => { this.notify(entry); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'output', terminalId: id, data, revision: entry.revision } }) })
    })
    pty.onExit(({ exitCode }) => { if (entry.closed) return; entry.closed = true; entry.exitCode = exitCode; this.notify(entry); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'exit', terminalId: id, exitCode } }) })
    return { id, title: entry.title, cwd, sessionId, snapshotId: this.snapshotId(entry), privateState: entry.privateState }
  }

  async toolAction(sessionId: string, request: TerminalToolRequest): Promise<TerminalToolResult> {
    const action = request.action
    if (action === 'help') return { ok: true, help: 'Use shared terminal for visible SSH, REPL and TUI state; prefer bash for ordinary commands. Mutations require terminal_id plus latest snapshot_id. Private input requires explicit user handoff.' }
    if (action === 'list') { const terminals = [...(this.spaces.get(sessionId)?.values() ?? [])].map(e => this.summary(e)); return { ok: true, terminals, activeTerminalId: this.active.get(sessionId), requiresSelection: terminals.length !== 1 } }
    if (action === 'open') { const opened = this.open(sessionId, request); const entry = this.get(sessionId, opened.id); this.reveal(entry); return this.observation(entry) }
    const usable = [...(this.spaces.get(sessionId)?.values() ?? [])]
    let entry: RecordEntry
    if (request.terminal_id) entry = this.get(sessionId, request.terminal_id)
    else if (usable.length === 1 && (action === 'observe' || action === 'wait')) entry = usable[0]
    else return { ok: false, error: usable.length ? 'multiple terminals; terminal_id is required' : 'no terminal in this session', requiresSelection: true, terminals: usable.map(e => this.summary(e)) }
    this.reveal(entry)
    if (action === 'observe') { this.ensurePublic(entry); return this.observation(entry) }
    if (action === 'request_private_input') { this.ensureMutable(entry, request.snapshot_id); entry.privateState = 'pending'; this.notify(entry); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'private', terminalId: entry.id, state: 'pending' } }); return { ok: true, terminalId: entry.id, snapshotId: this.snapshotId(entry), requiresUserInput: true, privateState: entry.privateState } }
    if (action === 'begin_private_input') { entry.privateState = 'active'; this.notify(entry); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'private', terminalId: entry.id, state: 'active' } }); return { ok: true, terminalId: entry.id, requiresUserInput: true, privateState: entry.privateState } }
    if (action === 'finish_private_input') { entry.privateState = 'none'; entry.screen.reset(); entry.resyncRequired = true; this.notify(entry); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'private', terminalId: entry.id, state: 'none' } }); return this.observation(entry) }
    if (action === 'cancel_private_input') { entry.privateState = 'none'; this.notify(entry); this.emit({ protocolVersion: PIPI_HOST_PROTOCOL_VERSION, channel: 'terminal', event: { type: 'private', terminalId: entry.id, state: 'none' } }); return this.observation(entry) }
    this.ensurePublic(entry)
    if (action === 'wait') {
      const initial = entry.revision; const timeout = Math.min(30_000, Math.max(50, Number(request.timeout ?? 10) * 1000)); const target = typeof request.text === 'string' ? request.text : undefined; const deadline = Date.now() + timeout
      while (!entry.closed && (target ? !this.observation(entry).screen?.includes(target) : entry.revision === initial) && Date.now() < deadline) await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); entry.changed.delete(done); resolve() }; const timer = setTimeout(done, Math.max(1, deadline - Date.now())); entry.changed.add(done) })
      this.ensurePublic(entry); return this.observation(entry)
    }
    if (action === 'send') return this.serial(entry, async () => { this.ensureMutable(entry, request.snapshot_id); entry.pty.write(String(request.text ?? '') + (request.enter ? '\r' : '')); this.notify(entry); return this.observation(entry) })
    if (action === 'key') return this.serial(entry, async () => { this.ensureMutable(entry, request.snapshot_id); const data = KEY_DATA[String(request.key)]; if (!data) throw new Error('unsupported terminal key'); entry.pty.write(data); this.notify(entry); return this.observation(entry) })
    if (action === 'resize') return this.serial(entry, async () => { this.ensureMutable(entry, request.snapshot_id); const cols = Math.max(2, Math.floor(Number(request.cols))); const rows = Math.max(1, Math.floor(Number(request.rows))); if (!Number.isFinite(cols) || !Number.isFinite(rows)) throw new Error('invalid terminal dimensions'); entry.cols = cols; entry.rows = rows; entry.pty.resize(cols, rows); entry.screen.resize(cols, rows); this.notify(entry); return this.observation(entry) })
    if (action === 'close') return this.serial(entry, async () => { this.ensureMutable(entry, request.snapshot_id); this.closeEntry(entry); return { ok: true, terminalId: entry.id, exitCode: entry.exitCode } })
    return { ok: false, error: `unsupported terminal action ${action}` }
  }

  private closeEntry(entry: RecordEntry) { if (!entry.closed) { entry.closed = true; entry.pty.kill(); this.notify(entry) } entry.screen.dispose() }
  disposeSession(sessionId: string) { for (const entry of this.spaces.get(sessionId)?.values() ?? []) this.closeEntry(entry); this.spaces.delete(sessionId); this.active.delete(sessionId) }
  closeAll() { for (const id of [...this.spaces.keys()]) this.disposeSession(id) }

  wrapBackend(backend: HostBackend): HostBackend {
    return { handle: async (method, params) => {
      if (method === 'terminalOpen') { const options = (params[0] ?? {}) as any; return this.open(String(options.sessionId ?? ''), options) }
      if (method === 'terminalWrite') { const entry = this.locateForRenderer(String(params[0])); if (entry.closed) throw new Error('terminal exited'); entry.pty.write(String(params[1])); return }
      if (method === 'terminalResize') { const entry = this.locateForRenderer(String(params[0])); const d = params[1] as any; entry.cols = Math.max(2, Math.floor(d.cols)); entry.rows = Math.max(1, Math.floor(d.rows)); entry.pty.resize(entry.cols, entry.rows); entry.screen.resize(entry.cols, entry.rows); this.notify(entry); return }
      if (method === 'terminalClear') { this.locateForRenderer(String(params[0])); return }
      if (method === 'terminalSnapshot') { const entry = this.locateForRenderer(String(params[0])); return { terminalId: entry.id, initialOutput: entry.resyncRequired ? '' : entry.serializer.serialize({ scrollback: 0 }), revision: entry.revision, cols: entry.cols, rows: entry.rows, ...(entry.resyncRequired ? { redacted: true, resyncRequired: true } : {}) } }
      if (method === 'terminalPrivate') { const entry = this.locateForRenderer(String(params[0])); return this.toolAction(entry.sessionId, { action: String(params[1]) as any, terminal_id: entry.id }) }
      if (method === 'terminalClose') { const entry = this.locateForRenderer(String(params[0])); this.closeEntry(entry); this.spaces.get(entry.sessionId)?.delete(entry.id); return }
      return backend.handle(method, params)
    }, subscribe: listener => { const own = this.subscribe(listener); const base = backend.subscribe(listener); return () => { own(); base() } } }
  }
}

export function createPtyTerminalBackend(backend: HostBackend, options: { spawn?: PtySpawn; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}) {
  const host = new TerminalSessionHost(options)
  return { backend: host.wrapBackend(backend), host, closeAll: () => host.closeAll() }
}
