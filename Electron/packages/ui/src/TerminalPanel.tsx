import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { PipiHostAPI, TerminalEvent, TerminalSession } from '@pipi/host-api'
import { DismissibleError } from './DismissibleError'
import './terminal.css'

type ThemeName = 'light' | 'dark'
type TerminalPatch = Partial<Pick<TerminalSession, 'title' | 'cwd' | 'privateState'>>

const fallbackTokens = {
  dark: { background: '#17181c', foreground: '#e5e7eb', strong: '#f3f4f6', selection: '#353750', accent: '#6578ea', accentSoft: '#33354c', danger: '#a75b63', warning: '#f5c76e', success: '#76c59b' },
  light: { background: '#f5f5f7', foreground: '#27272a', strong: '#17171a', selection: '#dbe5ff', accent: '#4968c9', accentSoft: '#e4eaff', danger: '#bd5962', warning: '#9a6816', success: '#28865a' }
} as const

function terminalTheme(element: HTMLElement, theme: ThemeName) {
  const tokens = fallbackTokens[theme]
  const style = window.getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const foreground = token('--text', tokens.foreground)
  const background = token('--bg', tokens.background)
  return {
    background,
    foreground,
    cursor: token('--text-strong', tokens.strong),
    cursorAccent: background,
    selectionBackground: token('--selection', tokens.selection),
    black: background,
    red: token('--danger', tokens.danger),
    green: token('--success', tokens.success),
    yellow: token('--warning', tokens.warning),
    blue: token('--accent', tokens.accent),
    magenta: token('--accent-soft', tokens.accentSoft),
    cyan: token('--accent', tokens.accent),
    white: token('--text-strong', tokens.strong),
    brightBlack: token('--muted', tokens.foreground),
    brightRed: token('--danger', tokens.danger),
    brightGreen: token('--success', tokens.success),
    brightYellow: token('--warning', tokens.warning),
    brightBlue: token('--accent', tokens.accent),
    brightMagenta: token('--accent', tokens.accent),
    brightCyan: token('--accent', tokens.accent),
    brightWhite: token('--text-strong', tokens.strong)
  }
}

function displayTitle(tab: TerminalSession, index: number, total: number) {
  const title = tab.title.trim() || '终端'
  return title === '终端' && total > 1 ? `终端 ${index + 1}` : title
}

export function TerminalPanel({ host, theme, sessionId, announcedTerminal, revealedTerminalId, projectId, projectPath, visible = true }: { host: PipiHostAPI; theme: ThemeName; sessionId?: string; announcedTerminal?: TerminalSession; revealedTerminalId?: string; projectId?: string; projectPath?: string; visible?: boolean }) {
  /**
   * Terminals are session-scoped: each chat session owns its own set, so switching sessions shows
   * that session's shells rather than someone else's. Every tab stays mounted regardless of which
   * session is showing — unmounting an xterm throws away its scrollback and kills the live process
   * view, and a session you come back to must look exactly as you left it.
   */
  const [tabs, setTabs] = useState<(TerminalSession & { sessionId?: string })[]>([])
  const [activeBySession, setActiveBySession] = useState<Record<string, string | undefined>>({})
  const [error, setError] = useState<string>()
  const startedSessions = useRef(new Set<string>())
  const sessionKey = sessionId ?? ''
  const sessionTabs = tabs.filter(tab => (tab.sessionId ?? '') === sessionKey)
  const activeId = activeBySession[sessionKey] ?? sessionTabs[0]?.id
  const activeSession = sessionTabs.find(tab => tab.id === activeId) ?? sessionTabs[0]

  const openTab = useCallback(async () => {
    const terminal = host.terminal
    if (!terminal) {
      setError('当前宿主尚未提供终端接口。')
      return
    }
    try {
      setError(undefined)
      const session = await terminal.open({ sessionId: sessionKey, projectId, cwd: projectPath })
      if (!session || typeof session.id !== 'string') throw new Error('宿主尚未实现终端会话。')
      setTabs(current => current.some(tab => tab.id === session.id) ? current : [...current, { ...session, sessionId: sessionKey }])
      setActiveBySession(current => ({ ...current, [sessionKey]: session.id }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [host, projectId, projectPath, sessionKey])

  useEffect(() => {
    // One terminal is opened per session, the first time that session is shown.
    if (startedSessions.current.has(sessionKey)) return
    if (announcedTerminal?.sessionId === sessionKey) { startedSessions.current.add(sessionKey); return }
    startedSessions.current.add(sessionKey)
    void openTab()
  }, [announcedTerminal, openTab, sessionKey])

  useEffect(() => host.terminal?.subscribeAll?.(event => {
    if (event.type === 'opened' && event.sessionId === sessionKey) setTabs(current => current.some(tab => tab.id === event.terminal.id) ? current : [...current, { ...event.terminal, sessionId: sessionKey }])
    if (event.type === 'reveal' && event.sessionId === sessionKey) setActiveBySession(current => ({ ...current, [sessionKey]: event.terminalId }))
    if (event.type === 'private') setTabs(current => current.map(tab => tab.id === event.terminalId ? { ...tab, privateState: event.state } : tab))
  }), [host, sessionKey])
  useEffect(() => {
    if (announcedTerminal?.sessionId === sessionKey) setTabs(current => current.some(tab => tab.id === announcedTerminal.id) ? current : [...current, { ...announcedTerminal, sessionId: sessionKey }])
  }, [announcedTerminal, sessionKey])
  useEffect(() => { if (revealedTerminalId) setActiveBySession(current => ({ ...current, [sessionKey]: revealedTerminalId })) }, [revealedTerminalId, sessionKey])

  const updateMetadata = useCallback((terminalId: string, patch: TerminalPatch) => {
    setTabs(current => current.map(tab => tab.id === terminalId ? { ...tab, ...patch } : tab))
  }, [])

  const closeTab = useCallback((terminalId: string) => {
    const index = sessionTabs.findIndex(tab => tab.id === terminalId)
    if (index < 0) return
    const remaining = sessionTabs.filter(tab => tab.id !== terminalId)
    setTabs(current => current.filter(tab => tab.id !== terminalId))
    setActiveBySession(current => current[sessionKey] === terminalId ? { ...current, [sessionKey]: remaining[Math.min(index, remaining.length - 1)]?.id } : current)
    void host.terminal?.close(terminalId).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    // Closing the session's last terminal reopens one: the panel is never a dead end.
    if (remaining.length === 0) { startedSessions.current.delete(sessionKey); void openTab() }
  }, [host, openTab, sessionKey, sessionTabs])

  if (!sessionTabs.length) {
    return <section className="terminal-panel terminal-empty" data-testid="terminal-panel" aria-live="polite">
      {error
        ? <DismissibleError message={error} onDismiss={() => setError(undefined)} onRetry={() => void openTab()} />
        : <b>正在连接终端…</b>}
    </section>
  }

  return <section className="terminal-panel" data-testid="terminal-panel">
    <nav className="terminal-tabs" aria-label="终端标签页" role="tablist">
      {sessionTabs.map((tab, index) => {
        const title = displayTitle(tab, index, sessionTabs.length)
        const selected = tab.id === activeId
        return <div className={`terminal-tab ${selected ? 'selected' : ''}`} key={tab.id}>
          <button role="tab" aria-selected={selected} aria-controls={`terminal-${tab.id}`} onClick={() => setActiveBySession(current => ({ ...current, [sessionKey]: tab.id }))}>{title}</button>
          <button className="terminal-tab-close" aria-label={`关闭 ${title}`} onClick={() => closeTab(tab.id)}>×</button>
        </div>
      })}
      <button className="terminal-new-tab" aria-label="新建终端" title="新建终端" onClick={() => void openTab()}>＋</button>
    </nav>
    <div className="terminal-sessions">
      {activeSession && <TerminalSurface key={activeSession.id} host={host} session={activeSession} theme={theme} fallbackCwd={projectPath} active={visible} onMetadata={updateMetadata} onError={setError} />}
    </div>
    {error && <DismissibleError className="terminal-error" message={error} onDismiss={() => setError(undefined)} />}
  </section>
}

function TerminalSurface({ host, session, theme, fallbackCwd, active, onMetadata, onError }: { host: PipiHostAPI; session: TerminalSession; theme: ThemeName; fallbackCwd?: string; active: boolean; onMetadata: (terminalId: string, patch: TerminalPatch) => void; onError: (message: string | undefined) => void }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal>()
  const fitAddonRef = useRef<FitAddon>()
  const activeRef = useRef(active)
  const [followingOutput, setFollowingOutput] = useState(true)
  activeRef.current = active

  const fit = useCallback(() => {
    const mount = mountRef.current
    if (!activeRef.current || !mount || mount.clientWidth === 0 || mount.clientHeight === 0) return
    try {
      fitAddonRef.current?.fit()
      const terminal = terminalRef.current
      if (terminal && terminal.cols > 0 && terminal.rows > 0) {
        void host.terminal?.resize?.(session.id, { cols: terminal.cols, rows: terminal.rows })
          .catch(reason => onError(reason instanceof Error ? reason.message : String(reason)))
      }
    } catch { /* xterm may be between layout passes */ }
  }, [host, onError, session.id])

  useLayoutEffect(() => {
    const mount = mountRef.current
    const terminalHost = host.terminal
    if (!mount || !terminalHost) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: terminalTheme(mount, theme)
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(mount)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    if (session.initialOutput) terminal.write(session.initialOutput)

    const input = terminal.onData(data => {
      void terminalHost.write(session.id, data).catch(reason => onError(reason instanceof Error ? reason.message : String(reason)))
    })
    const scroll = terminal.onScroll(() => {
      const buffer = terminal.buffer.active
      setFollowingOutput(buffer.viewportY >= buffer.baseY)
    })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    observer?.observe(mount)
    window.addEventListener('resize', fit)
    const animationFrame = window.requestAnimationFrame(fit)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', fit)
      observer?.disconnect()
      scroll.dispose()
      input.dispose()
      fitAddonRef.current = undefined
      terminalRef.current = undefined
      terminal.dispose()
    }
  }, [fit, host, onError, session.id, session.initialOutput])

  useEffect(() => {
    const terminal = terminalRef.current
    const mount = mountRef.current
    if (!terminal || !mount) return
    terminal.options.theme = terminalTheme(mount, theme)
  }, [theme])

  useEffect(() => {
    if (!active) return
    const animationFrame = window.requestAnimationFrame(() => {
      fit()
      terminalRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [active, fit])

  useEffect(() => {
    const terminal = host.terminal
    if (!terminal) return
    let attached = !terminal.snapshot
    const pending: Extract<TerminalEvent, { type: 'output' }>[] = []
    const unsubscribe = terminal.subscribe(session.id, (event: TerminalEvent) => {
      if (event.type === 'output' && !attached) { pending.push(event); return }
      if (event.type === 'output') terminalRef.current?.write(event.data)
      if (event.type === 'title') onMetadata(session.id, { title: event.title })
      if (event.type === 'cwd') onMetadata(session.id, { cwd: event.cwd })
      if (event.type === 'exit') onMetadata(session.id, { title: `终端（已退出 ${event.exitCode ?? '?'}）` })
      if (event.type === 'private') onMetadata(session.id, { privateState: event.state })
    })
    if (terminal.snapshot) void terminal.snapshot(session.id).then(frame => {
      const surface = terminalRef.current
      if (!surface) return
      surface.reset()
      if (frame.initialOutput) surface.write(frame.initialOutput)
      attached = true
      for (const event of pending) if (event.revision === undefined || event.revision > frame.revision) surface.write(event.data)
      pending.length = 0
    }).catch(reason => onError(reason instanceof Error ? reason.message : String(reason)))
    return unsubscribe
  }, [host, onMetadata, session.id])

  const clear = () => {
    terminalRef.current?.clear()
    setFollowingOutput(true)
  }

  const privateAction = (action: 'begin_private_input' | 'finish_private_input' | 'cancel_private_input') => {
    void host.terminal?.privateInput?.(session.id, action).catch(reason => onError(reason instanceof Error ? reason.message : String(reason)))
  }

  return <section id={`terminal-${session.id}`} className="terminal-session" role="tabpanel">
    <header className="terminal-session-header">
      <div className="terminal-session-meta">
        <span className="terminal-icon" aria-hidden="true">⌘</span>
        <div><strong>{session.title}</strong><small title={session.cwd ?? fallbackCwd ?? '终端会话'}>{session.cwd ?? fallbackCwd ?? '终端会话'}</small></div>
      </div>
      <div className="terminal-actions">
        {session.privateState === 'pending' && <><button onClick={() => privateAction('begin_private_input')}>开始私密输入</button><button onClick={() => privateAction('cancel_private_input')}>取消</button></>}
        {session.privateState === 'active' && <button onClick={() => privateAction('finish_private_input')}>完成私密输入并交还 Agent</button>}
        {!followingOutput && <button aria-label="回到终端底部" title="回到终端底部" onClick={() => { terminalRef.current?.scrollToBottom(); setFollowingOutput(true) }}>↓</button>}
        <button aria-label="清屏" title="清屏" onClick={clear}>⌫</button>
      </div>
    </header>
    <div className="terminal-xterm" ref={mountRef} data-testid={`xterm-surface-${session.id}`} role="application" aria-label={`终端内容：${session.title}`} onClick={() => terminalRef.current?.focus()} />
  </section>
}
