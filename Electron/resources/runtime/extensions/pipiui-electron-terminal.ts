// PipiUI shared terminal tool. Dormant outside an authenticated Electron session.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const PORT = process.env.PIPIUI_BRIDGE_PORT
const CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY
const KEYS = ['ENTER','TAB','ESCAPE','BACKSPACE','DELETE','UP','DOWN','LEFT','RIGHT','HOME','END','PAGE_UP','PAGE_DOWN','CTRL_C','CTRL_D','CTRL_Z'] as const
const NEED_VALUES = ['long-lived-process', 'repl', 'tui', 'ssh', 'interactive-prompt'] as const
type TerminalNeed = (typeof NEED_VALUES)[number]

const HELP = `terminal is last-resort: a visible instrument for long-lived processes, SSH, REPL, TUI, and answering a prompt already waiting. Never a substitute for read, ls, git, grep, find, or bash. If the shell is absent, dispatch a worker — do not type the command into this pane.
Actions: list, open, observe, wait, send, key, resize, close, request_private_input, help.
Each chat session owns multiple isolated terminals. Mutations require explicit terminal_id and the latest snapshot_id returned by observe.
observe may omit terminal_id only when this session has exactly one terminal. wait accepts text and timeout seconds.
send accepts text and enter=true. For unknown commands set need to one of: ${NEED_VALUES.join(', ')}. key accepts ${KEYS.join(', ')}.
For passwords, OTP and sudo prompts call request_private_input with exact terminal_id + current snapshot_id. The user enters secrets in the panel; the agent cannot observe or mutate until the user finishes. Finish returns redacted/resyncRequired until later public output arrives.`

const LAST_RESORT = 'terminal is last-resort. Try read, ls, git, grep, find, or bash first; if bash is absent, dispatch a worker — do not type the command into this pane.'

export type TerminalSendAssessment =
  | { ok: true }
  | { ok: false; error: string }

const DEDICATED: Record<string, string> = {
  ls: 'ls', tree: 'ls', pwd: 'ls',
  cat: 'read', head: 'read', tail: 'read', bat: 'read', less: 'read', more: 'read', nl: 'read',
  git: 'git',
  grep: 'grep', rg: 'grep', egrep: 'grep', fgrep: 'grep', ag: 'grep', ack: 'grep',
  find: 'find', fd: 'find',
}

const ONE_SHOT = new Set([
  'echo', 'printf', 'which', 'type', 'env', 'printenv', 'date', 'whoami', 'hostname', 'uname', 'id', 'stat', 'file', 'wc', 'du', 'df',
  'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'chmod', 'chown', 'ln',
  'curl', 'wget',
  'vitest', 'jest', 'mocha', 'pytest', 'tsc', 'eslint',
])

const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx'])
const PKG_ONESHOT = new Set(['test', 'build', 'lint', 'ci', 'typecheck', 'install', 'i'])
const PKG_RUN_LIVE = new Set(['dev', 'start', 'serve', 'watch', 'preview'])
const PROMPT = new Set(['y', 'n', 'yes', 'no', 'q', 'quit'])
const LIVE_CMD = new Set([
  'ssh', 'mosh', 'telnet',
  'htop', 'btop', 'top', 'tmux', 'screen', 'vim', 'nvim',
  'irb', 'ipython', 'psql',
])
const REPL_BARE = new Set(['python', 'python3', 'node'])
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t) return t
  }
  return ''
}

function splitChains(line: string): string[] {
  const parts: string[] = []
  let buf = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      buf += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      buf += c
      continue
    }
    const two = line.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      parts.push(buf)
      buf = ''
      i++
      continue
    }
    if (c === ';' || c === '|') {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += c
  }
  parts.push(buf)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function tokens(segment: string): string[] {
  return segment.trim().split(/\s+/).filter(Boolean)
}

function basename(cmd: string): string {
  const cleaned = cmd.replace(/^["']|["']$/g, '')
  const slash = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'))
  return (slash >= 0 ? cleaned.slice(slash + 1) : cleaned).toLowerCase()
}

function stripSudoAndEnv(toks: string[]): string[] {
  let i = 0
  if (toks[0]?.toLowerCase() === 'sudo') i = 1
  while (i < toks.length && ENV_ASSIGN.test(toks[i]) && !toks[i].includes('/')) i++
  return toks.slice(i)
}

function looksLikeScriptFile(arg: string | undefined): boolean {
  if (!arg || arg.startsWith('-')) return false
  return /\.(js|mjs|cjs|ts|tsx|jsx|py|mjs)$/i.test(arg) || arg.includes('/') || arg.startsWith('./')
}

function hasFollowFlag(args: string[]): boolean {
  return args.some((a) => a === '-f' || a === '--follow' || a.startsWith('-') && !a.startsWith('--') && a.includes('f'))
}

type Kind = 'dedicated' | 'oneshot' | 'live' | 'prompt' | 'unknown'

function classifySegment(segment: string): { kind: Kind; tool?: string } {
  const raw = stripSudoAndEnv(tokens(segment))
  if (raw.length === 0) return { kind: 'prompt' }
  const cmd = basename(raw[0])
  const args = raw.slice(1)

  if (cmd === 'tail' && hasFollowFlag(args)) return { kind: 'live' }
  if (cmd === 'journalctl' && hasFollowFlag(args)) return { kind: 'live' }

  if (DEDICATED[cmd]) return { kind: 'dedicated', tool: DEDICATED[cmd] }

  if (PKG.has(cmd)) {
    const sub = (args[0] || '').toLowerCase()
    if (PKG_RUN_LIVE.has(sub)) return { kind: 'live' }
    if (sub === 'run') {
      const script = (args[1] || '').toLowerCase()
      if (PKG_RUN_LIVE.has(script)) return { kind: 'live' }
      if (PKG_ONESHOT.has(script)) return { kind: 'oneshot' }
    }
    if (PKG_ONESHOT.has(sub)) return { kind: 'oneshot' }
  }

  if (cmd === 'vite' || cmd === 'next') {
    if (args.some((a) => a.toLowerCase() === 'build')) return { kind: 'oneshot' }
    return { kind: 'live' }
  }

  if (cmd === 'docker' || cmd === 'docker-compose') {
    const rest = cmd === 'docker' ? args : ['compose', ...args]
    if (rest[0] === 'compose' && rest[1] === 'up') return { kind: 'live' }
    if (rest[0] === 'attach') return { kind: 'live' }
    if (rest[0] === 'logs' && hasFollowFlag(rest.slice(1))) return { kind: 'live' }
    if (cmd === 'docker-compose' && args[0] === 'up') return { kind: 'live' }
  }

  if (REPL_BARE.has(cmd)) {
    const files = args.filter((a) => !a.startsWith('-'))
    if (files.some((a) => looksLikeScriptFile(a))) return { kind: 'oneshot' }
    return { kind: 'live' }
  }

  if (LIVE_CMD.has(cmd)) return { kind: 'live' }
  if (ONE_SHOT.has(cmd)) return { kind: 'oneshot' }
  if (raw.length === 1 && PROMPT.has(cmd)) return { kind: 'prompt' }
  return { kind: 'unknown' }
}

export function assessTerminalSend(text: unknown, need?: unknown): TerminalSendAssessment {
  const raw = typeof text === 'string' ? text : ''
  const line = firstLine(raw)
  if (!line) return { ok: true }

  const needOk = typeof need === 'string' && (NEED_VALUES as readonly string[]).includes(need)
  const segments = splitChains(line.replace(/^sudo\s+/i, ''))
  let sawLive = false
  let sawUnknown = false
  for (const seg of segments) {
    const c = classifySegment(seg)
    if (c.kind === 'dedicated') {
      return { ok: false, error: `Use the ${c.tool} tool, not terminal. ${LAST_RESORT}` }
    }
    if (c.kind === 'oneshot') {
      return { ok: false, error: `One-shot commands belong in bash if you have it, otherwise dispatch a worker. ${LAST_RESORT}` }
    }
    if (c.kind === 'live') sawLive = true
    if (c.kind === 'unknown') sawUnknown = true
  }
  if (sawLive) return { ok: true }
  if (!sawUnknown) return { ok: true }
  if (needOk) return { ok: true }
  return { ok: false, error: `${LAST_RESORT} Allowed send.need: ${NEED_VALUES.join(', ')}.` }
}

async function bridge(event: Record<string, unknown>, signal?: AbortSignal) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 35_000)
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ schemaVersion: 1, sessionCapability: CAPABILITY, action: 'terminal_action', event }) })
    return await response.json()
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
const result = (value: any) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], details: value, ...(value?.ok === false ? { isError: true } : {}) })

export default function (pi: ExtensionAPI) {
  if (!PORT || !CAPABILITY) return
  pi.registerTool({
    name: 'terminal', label: 'Terminal', description: 'Last-resort visible terminal for long-lived processes, SSH, REPL, TUI, and interactive prompts — not a faster shell. Never a substitute for read, ls, git, grep, find, or bash; if the shell is absent, dispatch a worker. For processes that outlive the command so you can watch them while other work happens. One-shot commands belong in bash. Actions: list, open, observe, wait, send, key, resize, close, request_private_input, help. Mutations require terminal_id + fresh snapshot_id. send.need is required for unknown commands.',
    parameters: Type.Object({
      action: Type.String(), terminal_id: Type.Optional(Type.String()), snapshot_id: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()),
      cols: Type.Optional(Type.Number({ minimum: 2, maximum: 500 })), rows: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
      text: Type.Optional(Type.String()), enter: Type.Optional(Type.Boolean()), key: Type.Optional(Type.Union(KEYS.map(key => Type.Literal(key)))),
      timeout: Type.Optional(Type.Number({ minimum: 0.05, maximum: 30 })),
      need: Type.Optional(Type.Union(NEED_VALUES.map(v => Type.Literal(v))))
    }),
    async execute(_id, params, signal) {
      if (params.action === 'help') return result({ ok: true, help: HELP })
      const allowed = new Set(['list','open','observe','wait','send','key','resize','close','request_private_input'])
      if (!allowed.has(params.action)) return result({ ok: false, error: `unsupported terminal action ${params.action}`, help: HELP })
      if (['send','key','resize','close','request_private_input'].includes(params.action) && (!params.terminal_id || !params.snapshot_id)) return result({ ok: false, error: `${params.action} requires terminal_id and snapshot_id`, help: HELP })
      if (params.action === 'send') {
        const gate = assessTerminalSend(params.text, params.need)
        if (!gate.ok) return result({ ok: false, error: gate.error, help: HELP })
      }
      return result(await bridge(params as Record<string, unknown>, signal))
    }
  })
}
