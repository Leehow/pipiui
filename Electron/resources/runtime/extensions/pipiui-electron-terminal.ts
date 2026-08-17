// PipiUI shared terminal tool. Dormant outside an authenticated Electron session.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

const PORT = process.env.PIPIUI_BRIDGE_PORT
const CAPABILITY = process.env.PIPIUI_SESSION_CAPABILITY
const KEYS = ['ENTER','TAB','ESCAPE','BACKSPACE','DELETE','UP','DOWN','LEFT','RIGHT','HOME','END','PAGE_UP','PAGE_DOWN','CTRL_C','CTRL_D','CTRL_Z'] as const
const HELP = `terminal controls the visible shared terminal for SSH, REPL and TUI work; prefer bash for ordinary commands.
Actions: list, open, observe, wait, send, key, resize, close, request_private_input, help.
Each chat session owns multiple isolated terminals. Mutations require explicit terminal_id and the latest snapshot_id returned by observe.
observe may omit terminal_id only when this session has exactly one terminal. wait accepts text and timeout seconds.
send accepts text and enter=true. key accepts ${KEYS.join(', ')}.
For passwords, OTP and sudo prompts call request_private_input with exact terminal_id + current snapshot_id. The user enters secrets in the panel; the agent cannot observe or mutate until the user finishes. Finish returns redacted/resyncRequired until later public output arrives.`

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
    name: 'terminal', label: 'Terminal', description: 'Control exact visible shared SSH/REPL/TUI terminals. Actions: list, open, observe, wait, send, key, resize, close, request_private_input, help. The main session can type, open, resize, and close terminals. Mutations require terminal_id + fresh snapshot_id.',
    parameters: Type.Object({
      action: Type.String(), terminal_id: Type.Optional(Type.String()), snapshot_id: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()),
      cols: Type.Optional(Type.Number({ minimum: 2, maximum: 500 })), rows: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
      text: Type.Optional(Type.String()), enter: Type.Optional(Type.Boolean()), key: Type.Optional(Type.Union(KEYS.map(key => Type.Literal(key)))),
      timeout: Type.Optional(Type.Number({ minimum: 0.05, maximum: 30 }))
    }),
    async execute(_id, params, signal) {
      if (params.action === 'help') return result({ ok: true, help: HELP })
      const allowed = new Set(['list','open','observe','wait','send','key','resize','close','request_private_input'])
      if (!allowed.has(params.action)) return result({ ok: false, error: `unsupported terminal action ${params.action}`, help: HELP })
      if (['send','key','resize','close','request_private_input'].includes(params.action) && (!params.terminal_id || !params.snapshot_id)) return result({ ok: false, error: `${params.action} requires terminal_id and snapshot_id`, help: HELP })
      return result(await bridge(params as Record<string, unknown>, signal))
    }
  })
}
